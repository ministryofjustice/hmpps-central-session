import session from "express-session";
import { RequestHandler } from "express";

import { createClient } from "redis";
import RedisStore from "connect-redis";

export type RedisClient = ReturnType<typeof createClient>;
export interface HmppsSessionConfig {
  https: boolean;
  session: {
    secret: string;
  };
}

export function hmppsSession(
  client: RedisClient,
  config: HmppsSessionConfig
): RequestHandler {
  return session({
    store: new RedisStore({ client }),
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
