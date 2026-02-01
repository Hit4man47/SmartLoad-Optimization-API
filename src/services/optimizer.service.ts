import type { Order, Truck, OptimizeResponse, SelectionState } from '../models/types';

export interface OptimizationConfig {
  revenueWeight: number;
  utilizationWeight: number;
  useBitmaskDP: boolean;
  returnParetoOptimal: boolean;
}

const DEFAULT_CONFIG: OptimizationConfig = {
  revenueWeight: 1.0,
  utilizationWeight: 0.0,
  useBitmaskDP: true,
  returnParetoOptimal: false,
};

interface CompatibilityGroup {
  route: string;
  isHazmat: boolean;
  orders: Order[];
}

interface ParetoSolution extends SelectionState {
  utilizationScore: number;
}

function groupByCompatibility(orders: Order[]): CompatibilityGroup[] {
  const groups = new Map<string, CompatibilityGroup>();

  for (const order of orders) {
    const route = `${order.origin} -> ${order.destination}`;
    const key = `${route}|${order.is_hazmat}`;

    if (!groups.has(key)) {
      groups.set(key, { route, isHazmat: order.is_hazmat, orders: [] });
    }
    groups.get(key)!.orders.push(order);
  }

  return Array.from(groups.values());
}

function timeWindowsOverlap(a: Order, b: Order): boolean {
  const p1 = new Date(a.pickup_date).getTime();
  const d1 = new Date(a.delivery_date).getTime();
  const p2 = new Date(b.pickup_date).getTime();
  const d2 = new Date(b.delivery_date).getTime();

  // windows overlap if latest pickup <= earliest delivery
  return Math.max(p1, p2) <= Math.min(d1, d2);
}

function buildCompatMatrix(orders: Order[]): boolean[][] {
  const n = orders.length;
  const compat: boolean[][] = Array(n).fill(null).map(() => Array(n).fill(true));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ok = timeWindowsOverlap(orders[i], orders[j]);
      compat[i][j] = ok;
      compat[j][i] = ok;
    }
  }
  return compat;
}

function checkSelection(mask: number, compat: boolean[][], n: number): boolean {
  const selected: number[] = [];

  for (let i = 0; i < n; i++) {
    if (mask & (1 << i)) selected.push(i);
  }

  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      if (!compat[selected[i]][selected[j]]) return false;
    }
  }
  return true;
}

// bitmask dp - enumerate all 2^n subsets
function solveBitmask(
  orders: Order[],
  maxW: number,
  maxV: number,
  cfg: OptimizationConfig
): SelectionState {
  const n = orders.length;

  // single order case
  if (n === 1) {
    const o = orders[0];
    if (o.weight_lbs <= maxW && o.volume_cuft <= maxV) {
      return {
        selectedIds: [o.id],
        totalPayout: o.payout_cents,
        totalWeight: o.weight_lbs,
        totalVolume: o.volume_cuft,
      };
    }
    return { selectedIds: [], totalPayout: 0, totalWeight: 0, totalVolume: 0 };
  }

  const compat = buildCompatMatrix(orders);

  let best: SelectionState = {
    selectedIds: [],
    totalPayout: 0,
    totalWeight: 0,
    totalVolume: 0,
  };
  let bestScore = 0;

  const total = 1 << n;

  for (let mask = 1; mask < total; mask++) {
    let w = 0, v = 0, pay = 0;
    const ids: string[] = [];

    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        w += orders[i].weight_lbs;
        v += orders[i].volume_cuft;
        pay += orders[i].payout_cents;
        ids.push(orders[i].id);
      }
    }

    if (w > maxW || v > maxV) continue;
    if (!checkSelection(mask, compat, n)) continue;

    const util = (w / maxW + v / maxV) / 2;
    const score = cfg.revenueWeight * pay + cfg.utilizationWeight * util * 1000000;

    if (score > bestScore) {
      bestScore = score;
      best = { selectedIds: ids, totalPayout: pay, totalWeight: w, totalVolume: v };
    }
  }

  return best;
}

function calcUpperBound(
  orders: Order[],
  idx: number,
  curPay: number,
  wLeft: number,
  vLeft: number
): number {
  let ub = curPay;

  for (let i = idx; i < orders.length; i++) {
    const o = orders[i];
    if (o.weight_lbs <= wLeft && o.volume_cuft <= vLeft) {
      ub += o.payout_cents;
      wLeft -= o.weight_lbs;
      vLeft -= o.volume_cuft;
    } else {
      // fractional relaxation for bound
      const wFrac = o.weight_lbs > 0 ? wLeft / o.weight_lbs : 1;
      const vFrac = o.volume_cuft > 0 ? vLeft / o.volume_cuft : 1;
      ub += Math.floor(o.payout_cents * Math.min(wFrac, vFrac, 1));
      break;
    }
  }
  return ub;
}

// branch and bound fallback for n > 22
function solveBnB(
  orders: Order[],
  maxW: number,
  maxV: number,
  _cfg: OptimizationConfig
): SelectionState {
  const n = orders.length;

  // sort by payout density
  const sorted = [...orders].sort((a, b) => {
    const da = a.payout_cents / (a.weight_lbs + a.volume_cuft);
    const db = b.payout_cents / (b.weight_lbs + b.volume_cuft);
    return db - da;
  });

  const compat = buildCompatMatrix(sorted);

  let best: SelectionState = {
    selectedIds: [],
    totalPayout: 0,
    totalWeight: 0,
    totalVolume: 0,
  };

  const selIdx: number[] = [];

  function search(
    i: number,
    curW: number,
    curV: number,
    curPay: number,
    curIds: string[]
  ): void {
    if (curPay > best.totalPayout) {
      best = {
        selectedIds: [...curIds],
        totalPayout: curPay,
        totalWeight: curW,
        totalVolume: curV,
      };
    }

    if (i >= n) return;

    // prune
    const ub = calcUpperBound(sorted, i, curPay, maxW - curW, maxV - curV);
    if (ub <= best.totalPayout) return;

    const o = sorted[i];
    const newW = curW + o.weight_lbs;
    const newV = curV + o.volume_cuft;

    if (newW <= maxW && newV <= maxV) {
      let ok = true;
      for (const idx of selIdx) {
        if (!compat[i][idx]) { ok = false; break; }
      }

      if (ok) {
        selIdx.push(i);
        curIds.push(o.id);
        search(i + 1, newW, newV, curPay + o.payout_cents, curIds);
        curIds.pop();
        selIdx.pop();
      }
    }

    search(i + 1, curW, curV, curPay, curIds);
  }

  search(0, 0, 0, 0, []);
  return best;
}

function findPareto(
  orders: Order[],
  maxW: number,
  maxV: number
): ParetoSolution[] {
  const n = orders.length;
  const compat = buildCompatMatrix(orders);
  const sols: ParetoSolution[] = [];

  const total = 1 << n;

  for (let mask = 0; mask < total; mask++) {
    let w = 0, v = 0, pay = 0;
    const ids: string[] = [];

    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        w += orders[i].weight_lbs;
        v += orders[i].volume_cuft;
        pay += orders[i].payout_cents;
        ids.push(orders[i].id);
      }
    }

    if (w > maxW || v > maxV) continue;
    if (!checkSelection(mask, compat, n)) continue;

    const util = (w / maxW + v / maxV) / 2;
    sols.push({ selectedIds: ids, totalPayout: pay, totalWeight: w, totalVolume: v, utilizationScore: util });
  }

  // filter dominated solutions
  return sols.filter((s) => {
    return !sols.some(other =>
      other !== s &&
      other.totalPayout >= s.totalPayout &&
      other.utilizationScore >= s.utilizationScore &&
      (other.totalPayout > s.totalPayout || other.utilizationScore > s.utilizationScore)
    );
  });
}

export function optimizeLoad(
  truck: Truck,
  orders: Order[],
  config: Partial<OptimizationConfig> = {}
): OptimizeResponse {
  const cfg: OptimizationConfig = { ...DEFAULT_CONFIG, ...config };

  if (orders.length === 0) {
    return emptyResponse(truck);
  }

  // filter out orders that don't fit by themselves
  const feasible = orders.filter(
    o => o.weight_lbs <= truck.max_weight_lbs && o.volume_cuft <= truck.max_volume_cuft
  );

  if (feasible.length === 0) {
    return emptyResponse(truck);
  }

  const groups = groupByCompatibility(feasible);

  let bestOverall: SelectionState = {
    selectedIds: [],
    totalPayout: 0,
    totalWeight: 0,
    totalVolume: 0,
  };

  for (const g of groups) {
    const useDP = cfg.useBitmaskDP && g.orders.length <= 22;

    const result = useDP
      ? solveBitmask(g.orders, truck.max_weight_lbs, truck.max_volume_cuft, cfg)
      : solveBnB(g.orders, truck.max_weight_lbs, truck.max_volume_cuft, cfg);

    if (result.totalPayout > bestOverall.totalPayout) {
      bestOverall = result;
    }
  }

  return buildResponse(truck, bestOverall);
}

export function optimizeLoadPareto(
  truck: Truck,
  orders: Order[]
): { best: OptimizeResponse; paretoOptimal: ParetoSolution[] } {
  const feasible = orders.filter(
    o => o.weight_lbs <= truck.max_weight_lbs && o.volume_cuft <= truck.max_volume_cuft
  );

  if (feasible.length === 0) {
    return { best: emptyResponse(truck), paretoOptimal: [] };
  }

  const groups = groupByCompatibility(feasible);
  let allPareto: ParetoSolution[] = [];

  for (const g of groups) {
    const sols = findPareto(g.orders, truck.max_weight_lbs, truck.max_volume_cuft);
    allPareto = allPareto.concat(sols);
  }

  const best = allPareto.reduce((a, b) =>
    a.totalPayout > b.totalPayout ? a : b,
    { selectedIds: [], totalPayout: 0, totalWeight: 0, totalVolume: 0, utilizationScore: 0 }
  );

  return { best: buildResponse(truck, best), paretoOptimal: allPareto };
}

function emptyResponse(truck: Truck): OptimizeResponse {
  return {
    truck_id: truck.id,
    selected_order_ids: [],
    total_payout_cents: 0,
    total_weight_lbs: 0,
    total_volume_cuft: 0,
    utilization_weight_percent: 0,
    utilization_volume_percent: 0,
  };
}

function buildResponse(truck: Truck, state: SelectionState): OptimizeResponse {
  const wUtil = truck.max_weight_lbs > 0
    ? Number(((state.totalWeight / truck.max_weight_lbs) * 100).toFixed(2))
    : 0;

  const vUtil = truck.max_volume_cuft > 0
    ? Number(((state.totalVolume / truck.max_volume_cuft) * 100).toFixed(2))
    : 0;

  return {
    truck_id: truck.id,
    selected_order_ids: state.selectedIds,
    total_payout_cents: state.totalPayout,
    total_weight_lbs: state.totalWeight,
    total_volume_cuft: state.totalVolume,
    utilization_weight_percent: wUtil,
    utilization_volume_percent: vUtil,
  };
}
