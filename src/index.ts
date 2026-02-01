import express, { Request, Response, NextFunction } from 'express';
import optimizerRoutes from './routes/optimizer';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '1mb' }));

// handle json parse errors
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  if (err.message?.includes('request entity too large')) {
    res.status(413).json({ error: 'Payload too large' });
    return;
  }
  next(err);
});

app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/actuator/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP' });
});

app.use('/api/v1/load-optimizer', optimizerRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
