import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

/**
 * Standalone DataSource for the TypeORM CLI (migration:run, migration:generate,
 * migration:revert). The runtime app uses TypeOrmModule.forRootAsync in
 * AppModule and never imports this file — the duplication is intentional
 * because the CLI tool runs outside the Nest dependency-injection context
 * and needs a config it can read directly.
 *
 * Both configs MUST stay in sync on connection params; entity discovery and
 * migration paths use the same glob patterns. Phase 2 adds enough schema
 * churn that running migrations explicitly via the CLI is much safer than
 * the synchronize:true auto-sync we relied on through Phase 1.
 */
dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // CLI loads compiled JS in dist/ (`npm run build` first) OR raw TS via
  // ts-node when invoked through the npm scripts. Glob covers both.
  entities: ['src/**/*.entity.ts', 'dist/**/*.entity.js'],
  migrations: ['src/migrations/*.ts', 'dist/migrations/*.js'],
  synchronize: false,
  logging: ['error', 'warn', 'migration'],
});
