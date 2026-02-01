import { Router, Request, Response } from 'express';
import { validateOptimizeRequest, validateDateConstraints, validateUniqueOrderIds } from '../utils/validation';
import { optimizeLoad, optimizeLoadPareto } from '../services/optimizer.service';

const router = Router();

router.post('/optimize', (req: Request, res: Response) => {
  try {
    const validation = validateOptimizeRequest(req.body);

    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.errors });
      return;
    }

    const { truck, orders, revenue_weight, utilization_weight } = validation.data;

    const dateErrs = validateDateConstraints(orders);
    if (dateErrs.length > 0) {
      res.status(400).json({ error: 'Invalid date constraints', details: dateErrs });
      return;
    }

    const dupeErrs = validateUniqueOrderIds(orders);
    if (dupeErrs.length > 0) {
      res.status(400).json({ error: 'Invalid order IDs', details: dupeErrs });
      return;
    }

    const result = optimizeLoad(truck, orders, {
      revenueWeight: revenue_weight ?? 1.0,
      utilizationWeight: utilization_weight ?? 0.0,
      useBitmaskDP: true,
      returnParetoOptimal: false,
    });

    res.status(200).json(result);
  } catch (err) {
    console.error('Optimization error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.post('/optimize/pareto', (req: Request, res: Response) => {
  try {
    const validation = validateOptimizeRequest(req.body);

    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.errors });
      return;
    }

    const { truck, orders } = validation.data;

    const dateErrs = validateDateConstraints(orders);
    if (dateErrs.length > 0) {
      res.status(400).json({ error: 'Invalid date constraints', details: dateErrs });
      return;
    }

    const dupeErrs = validateUniqueOrderIds(orders);
    if (dupeErrs.length > 0) {
      res.status(400).json({ error: 'Invalid order IDs', details: dupeErrs });
      return;
    }

    const { best, paretoOptimal } = optimizeLoadPareto(truck, orders);

    res.status(200).json({
      ...best,
      pareto_solutions: paretoOptimal.map(s => ({
        selected_order_ids: s.selectedIds,
        total_payout_cents: s.totalPayout,
        total_weight_lbs: s.totalWeight,
        total_volume_cuft: s.totalVolume,
        utilization_score: Number(s.utilizationScore.toFixed(4)),
      })),
    });
  } catch (err) {
    console.error('Pareto optimization error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
