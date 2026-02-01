# SmartLoad Optimization API

API for optimal truck load planning - maximizes revenue while respecting weight/volume limits and compatibility constraints.

## How to run

```bash
docker compose up --build
```
Run in BG
```bash
docker compose up --build -d
```

Service runs at http://localhost:8080

## Health check

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/actuator/health
```

## Endpoints

### Optimize Load (Single Best Solution)

```bash
curl -X POST http://localhost:8080/api/v1/load-optimizer/optimize \
  -H "Content-Type: application/json" \
  -d @sample-request.json
```

### Optimize Load (Pareto-Optimal Solutions)

Returns multiple trade-off solutions between revenue and utilization.

```bash
curl -X POST http://localhost:8080/api/v1/load-optimizer/optimize/pareto \
  -H "Content-Type: application/json" \
  -d @sample-request.json
```

## Request format

```json
{
  "truck": {
    "id": "truck-123",
    "max_weight_lbs": 44000,
    "max_volume_cuft": 3000
  },
  "orders": [
    {
      "id": "ord-001",
      "payout_cents": 250000,
      "weight_lbs": 18000,
      "volume_cuft": 1200,
      "origin": "Los Angeles, CA",
      "destination": "Dallas, TX",
      "pickup_date": "2025-12-05",
      "delivery_date": "2025-12-09",
      "is_hazmat": false
    }
  ],
  "revenue_weight": 1.0,
  "utilization_weight": 0.0
}
```

### Optional parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `revenue_weight` | 1.0 | Weight for revenue in optimization score |
| `utilization_weight` | 0.0 | Weight for truck utilization in optimization score |

Set `utilization_weight > 0` to prefer fuller trucks even if revenue is slightly lower.

## Response format

### Standard optimize response

```json
{
  "truck_id": "truck-123",
  "selected_order_ids": ["ord-001", "ord-002"],
  "total_payout_cents": 430000,
  "total_weight_lbs": 30000,
  "total_volume_cuft": 2100,
  "utilization_weight_percent": 68.18,
  "utilization_volume_percent": 70
}
```

### Pareto optimize response

Includes `pareto_solutions` array with all non-dominated trade-off solutions.

```json
{
  "truck_id": "truck-123",
  "selected_order_ids": ["ord-001", "ord-002"],
  "total_payout_cents": 430000,
  "total_weight_lbs": 30000,
  "total_volume_cuft": 2100,
  "utilization_weight_percent": 68.18,
  "utilization_volume_percent": 70,
  "pareto_solutions": [
    {
      "selected_order_ids": ["ord-001", "ord-002"],
      "total_payout_cents": 430000,
      "total_weight_lbs": 30000,
      "total_volume_cuft": 2100,
      "utilization_score": 0.6909
    },
    {
      "selected_order_ids": ["ord-003"],
      "total_payout_cents": 320000,
      "total_weight_lbs": 30000,
      "total_volume_cuft": 1800,
      "utilization_score": 0.6409
    }
  ]
}
```

## Constraints handled

- Weight and volume limits
- Same route only (origin -> destination must match)
- Hazmat isolation (hazmat orders can't mix with non-hazmat)
- Time window overlap (pickup/delivery dates must be compatible)

## Algorithm

Uses bitmask DP for n <= 22 orders (O(2^n * n^2) due to pairwise compatibility checks), falls back to branch and bound with pruning for larger inputs.

## Local dev

```bash
npm install
npm run build
npm start
```
