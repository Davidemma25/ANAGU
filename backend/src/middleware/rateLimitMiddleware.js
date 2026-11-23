const attempts = new Map();

export function createRateLimit({ windowMs = 15 * 60 * 1000, max = 10, keyPrefix = 'auth' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}:${req.path}`;
    const existing = attempts.get(key);
    const current =
      existing && now - existing.startedAt < windowMs
        ? existing
        : { startedAt: now, count: 0 };

    current.count += 1;
    attempts.set(key, current);

    if (current.count > max) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many attempts. Please wait and try again.',
      });
    }

    return next();
  };
}
