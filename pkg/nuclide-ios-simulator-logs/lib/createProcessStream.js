/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import {observeProcess} from '../../commons-node/process';
import featureConfig from '../../commons-atom/featureConfig';
import invariant from 'assert';
import os from 'os';
import nuclideUri from '../../commons-node/nuclideUri';
import {Observable} from 'rxjs';

const VALID_UDID = /^[a-f0-9-]+$/i;

export function createProcessStream(): Observable<string> {
  const currentDeviceUdids = observeProcess('bash', ['-c', WATCH_CURRENT_UDID_SCRIPT])
    .map(event => {
      if (event.kind === 'error') {
        throw event.error;
      } else if (event.kind === 'exit' && event.exitCode !== 0) {
        throw new Error('Error getting active iOS Simulator');
      }
      return event;
    })
    .filter(event => event.kind === 'stdout')
    .map(event => {
      invariant(typeof event.data === 'string');
      return event.data;
    })
    .map(output => output.trim())
    .filter(udid => VALID_UDID.test(udid))
    .distinctUntilChanged();

  // Whenever the current device changes, start tailing that device's logs.
  return currentDeviceUdids
    .switchMap(udid => {
      const logDir = nuclideUri.join(
        os.homedir(),
        'Library',
        'Logs',
        'CoreSimulator',
        udid,
        'asl',
      );
      return observeProcess(
        ((featureConfig.get('nuclide-ios-simulator-logs.pathToSyslog'): any): string),
        [
          '-w',
          '-F', 'xml',
          '-d', logDir,
        ],
      )
        .map(event => {
          if (event.kind === 'error') {
            throw event.error;
          }
          return event;
        })
        .filter(event => event.kind === 'stdout')
        .map(event => {
          invariant(typeof event.data === 'string');
          return event.data;
        });
    });
}

// A small shell script for polling the current device UDID. This allows us to avoid spawning a new
// process every interval.
const WATCH_CURRENT_UDID_SCRIPT = `
  set -e;
  while true; do
    defaults read com.apple.iphonesimulator CurrentDeviceUDID;
    sleep 2;
  done;
`;
