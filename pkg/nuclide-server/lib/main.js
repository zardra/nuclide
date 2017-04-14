/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import fs from 'fs';
import {
  flushLogsAndAbort,
  flushLogsAndExit,
  getLogger,
  initialUpdateConfig,
} from '../../nuclide-logging';
import {startTracking} from '../../nuclide-analytics';
import NuclideServer from './NuclideServer';
import servicesConfig from './servicesConfig';
import yargs from 'yargs';

const DEFAULT_PORT = 9090;

const logger = getLogger();

export type AgentOptions = {
  ca?: Buffer,
  key?: Buffer,
  cert?: Buffer,
  family?: 4 | 6,
};

async function main(args) {
  const serverStartTimer = startTracking('nuclide-server:start');
  process.on('SIGHUP', () => {});

  try {
    const {port, expiration_days} = args;
    if (expiration_days) {
      setTimeout(() => {
        logger.warn(`NuclideServer exiting - ${expiration_days} day expiration time reached.`);
        flushLogsAndExit(0);
      }, expiration_days * 24 * 60 * 60 * 1000);
    }
    let {key, cert, ca} = args;
    if (key && cert && ca) {
      key = fs.readFileSync(key);
      cert = fs.readFileSync(cert);
      ca = fs.readFileSync(ca);
    }
    const server = new NuclideServer({
      port,
      serverKey: key,
      serverCertificate: cert,
      certificateAuthorityCertificate: ca,
      trackEventLoop: true,
    }, servicesConfig);
    await server.connect();
    serverStartTimer.onSuccess();
    logger.info(`NuclideServer started on port ${port}.`);
    logger.info(`Using node ${process.version}.`);
    logger.info(`Server ready time: ${process.uptime() * 1000}ms`);
  } catch (e) {
    // Ensure logging is configured.
    await initialUpdateConfig();
    await serverStartTimer.onError(e);
    logger.fatal(e);
    flushLogsAndAbort();
  }
}

// This should never happen because the server must be started with stderr redirected to a log file.
process.stderr.on('error', error => {
  throw new Error('Can not write to stderr! :' + error);
});

process.on('uncaughtException', err => {
  // Log the error and continue the server crash.
  logger.fatal('uncaughtException:', err);
  // According to the docs, we need to close our server when this happens once we logged or
  // handled it: https://nodejs.org/api/process.html#process_event_uncaughtexception
  flushLogsAndAbort();
});

// This works in io.js as of v2.4.0 (possibly earlier versions, as well). Support for this was
// introduced by https://github.com/nodejs/io.js/pull/758 in io.js.
//
// Unfortunately, the analogous change was rejected in Node v0.12.x:
// https://github.com/joyent/node/issues/8997.
//
// We include this code here in anticipation of the Node/io.js merger.
process.on('unhandledRejection', (error, promise) => {
  logger.error(`Unhandled promise rejection ${promise}. Error:`, error);
});

const argv = yargs
    .default('port', DEFAULT_PORT)
    .argv;

main(argv);

// Make it clear that this is not a types module by adding an empty export.
export {};
