import session, { Store } from "express-session";
import { RequestHandler } from "express";
import { createClient } from "redis";
import RedisStore from "connect-redis";

export type RedisClient = ReturnType<typeof createClient>;
export interface HmppsSessionConfig {
  https: boolean;
  session: {
    secret: string;
  };
  sharedSession: {
    host: string;
    port: number;
    password: string;
    tls_enabled: string;
  };
}

declare module "express-session" {
  // Declare that the session will potentially contain these additional fields
  interface SessionData {
    cats: string;
  }
}

export const createSharedRedisClient = (
  config: HmppsSessionConfig
): RedisClient => {
  const url =
    config.sharedSession.tls_enabled === "true"
      ? `rediss://${config.sharedSession.host}:${config.sharedSession.port}`
      : `redis://${config.sharedSession.host}:${config.sharedSession.port}`;

  const client = createClient({
    url,
    password: config.sharedSession.password,
    socket: {
      reconnectStrategy: (attempts: number) => {
        // Exponential back off: 20ms, 40ms, 80ms..., capped to retry every 30 seconds
        const nextDelay = Math.min(2 ** attempts * 20, 30000);
        console.info(
          `Retry Redis connection attempt: ${attempts}, next attempt in: ${nextDelay}ms`
        );
        return nextDelay;
      },
    },
  });

  client.on("error", (e: Error) => console.error("Redis client error", e));

  return client;
};

export function hmppsSession(
  client: RedisClient,
  config: HmppsSessionConfig
): RequestHandler {
  return session({
    store: new HmppsSessionStore(client, config),
    cookie: {
      secure: config.https,
      sameSite: "lax",
      maxAge: 120 * 60 * 1000, // 120 minutes
    },
    secret: config.session.secret,
    resave: false, // redis implements touch so shouldn't need this
    saveUninitialized: false,
    rolling: true,
  });
}

export class HmppsSessionStore extends Store {
  private sharedSessionStore: RedisStore;
  private sharedSessionClient: RedisClient;
  private serviceStore: RedisStore;
  private serviceClient: RedisClient;

  constructor(client: RedisClient, config: HmppsSessionConfig) {
    super();
    this.sharedSessionClient = createSharedRedisClient(config);
    this.sharedSessionStore = new RedisStore({
      client: this.sharedSessionClient,
    });
    this.serviceClient = client;
    this.serviceStore = new RedisStore({ client });
  }

  private async ensureClientConnected(client: RedisClient) {
    if (!client.isOpen) {
      await client.connect();
    }
  }

  private async ensureConnections() {
    await Promise.all([
      this.ensureClientConnected(this.sharedSessionClient),
      this.ensureClientConnected(this.serviceClient),
    ]);
  }

  async get(
    sid: string,
    callback: (err: any, session?: session.SessionData) => void
  ): Promise<void> {
    console.log("Getting session: ", sid);
    await this.ensureConnections();
    let localSession = {};
    let centralSession = {};
    const setLocal = (err: any, sessionRes?: session.SessionData) => {
      if (err) console.log("Error getting local: ", err);
      localSession = sessionRes || {};
    };

    const setCentral = (err: any, sessionRes?: session.SessionData) => {
      if (err) console.log("Error getting central: ", err);
      centralSession = sessionRes || {};
    };

    await Promise.all([
      this.serviceStore.get(sid, setLocal),
      this.sharedSessionStore.get(sid, setCentral),
    ]);

    const session = { ...localSession, ...centralSession };
    callback("", session as any);
  }

  async set(
    sid: string,
    session: session.SessionData,
    callback?: (err?: any) => void
  ): Promise<void> {
    console.log("Setting session: ", sid);
    await this.ensureConnections();
    const { cookie, passport, ...localSession } = session as any;
    const c = (err?: string) => {
      if (err) console.log(err);
    };

    await Promise.all([
      this.serviceStore.set(sid, { cookie, ...localSession }, c),
      this.sharedSessionStore.set(sid, { cookie, passport } as any, c),
      // this.serviceStore.set(sid, session, c),
      // this.sharedSessionStore.set(sid, session, c),
    ]);
    callback();
  }

  async destroy(sid: string, callback?: (err?: any) => void): Promise<void> {
    console.log("Destroying session: ", sid);
    await Promise.all([
      this.serviceStore.destroy(sid, (err) =>
        console.log("Destruction service: ", err)
      ),
      this.sharedSessionStore.destroy(sid, (err) =>
        console.log("Destruction shared: ", err)
      ),
    ]);
    if (callback) callback();
  }
}
