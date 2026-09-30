import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { LiveMessage, PriceTick } from '@pecule/shared';
import { pg } from '../db.js';

type FeedStatus = Extract<LiveMessage, { type: 'feed-status' }>['sources'];

/**
 * Relais temps réel : écoute les notifications PostgreSQL émises par le service de flux
 * (`price_tick`, `feed_status`) et les diffuse à tous les appareils connectés.
 * Se reconnecte seul si la base redémarre.
 */
export class LiveHub {
  private clients = new Set<WebSocket>();
  private listener: pg.Client | null = null;
  private stopped = false;
  private retryDelay = 1000;
  private heartbeat: NodeJS.Timeout | null = null;
  feedStatus: FeedStatus = {};

  constructor(
    private readonly connectionString: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    // Ping régulier : garde les connexions ouvertes à travers les proxys et détecte les appareils partis.
    this.heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.readyState === ws.OPEN) ws.ping();
      }
    }, 25_000);
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('error', (err) => {
      this.log.warn({ err }, 'Connexion LISTEN perdue, nouvelle tentative');
      this.scheduleReconnect();
    });
    client.on('notification', (msg) => this.onNotification(msg.channel, msg.payload));
    try {
      await client.connect();
      await client.query('LISTEN price_tick');
      await client.query('LISTEN feed_status');
      this.listener = client;
      this.retryDelay = 1000;
      this.log.info('Relais temps réel à l’écoute');
    } catch (err) {
      this.log.warn({ err }, 'Impossible d’écouter la base, nouvelle tentative');
      await client.end().catch(() => {});
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const old = this.listener;
    this.listener = null;
    old?.end().catch(() => {});
    if (this.stopped) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    setTimeout(() => void this.connect(), delay);
  }

  private onNotification(channel: string, payload: string | undefined): void {
    if (!payload) return;
    try {
      if (channel === 'price_tick') {
        const tick = JSON.parse(payload) as PriceTick;
        this.broadcast({ type: 'tick', tick });
      } else if (channel === 'feed_status') {
        this.feedStatus = JSON.parse(payload) as FeedStatus;
        this.broadcast({ type: 'feed-status', sources: this.feedStatus });
      }
    } catch (err) {
      this.log.warn({ err, channel }, 'Notification illisible ignorée');
    }
  }

  add(ws: WebSocket, snapshot: PriceTick[]): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    this.send(ws, { type: 'snapshot', ticks: snapshot });
    this.send(ws, { type: 'feed-status', sources: this.feedStatus });
  }

  broadcast(message: LiveMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  private send(ws: WebSocket, message: LiveMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get listening(): boolean {
    return this.listener !== null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const ws of this.clients) ws.close(1001, 'Arrêt du serveur');
    await this.listener?.end().catch(() => {});
    this.listener = null;
  }
}
