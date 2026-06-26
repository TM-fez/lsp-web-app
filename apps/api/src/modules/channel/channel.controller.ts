import type { Request, Response, NextFunction } from 'express';
import { ChannelService } from './channel.service.js';

export class ChannelController {
  constructor(private readonly service: ChannelService) {}

  // GET /ical/units/:token(.ics) — public, token-guarded iCal feed for one unit.
  exportUnitFeed = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.params.token;
      const token = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
      const feed = await this.service.buildUnitFeed(token);
      if (!feed.found) {
        return res
          .status(404)
          .json({ statusCode: 404, error: 'Not Found', message: 'Unknown calendar' });
      }
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${feed.filename}"`);
      // OTAs poll this periodically; let them, but never serve a stale snapshot.
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(feed.ics);
    } catch (err) {
      next(err);
    }
  };
}
