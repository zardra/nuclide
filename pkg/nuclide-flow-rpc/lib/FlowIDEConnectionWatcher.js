/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import {FlowIDEConnection} from './FlowIDEConnection';

import {sleep} from '../../commons-node/promise';
import {getLogger} from '../../nuclide-logging';

const defaultIDEConnectionFactory = proc => new FlowIDEConnection(proc);

// ESLint thinks the comment at the end is whitespace and warns. Worse, the autofix removes the
// entire comment as well as the whitespace.
// eslint-disable-next-line semi-spacing
const IDE_CONNECTION_MAX_WAIT_MS = 20 /* min */ * 60 /* s/min */ * 1000 /* ms/s */;

const IDE_CONNECTION_MIN_INTERVAL_MS = 1000;

// For the lifetime of this class instance, keep a FlowIDEConnection alive, assuming we do not have
// too many failures in a row.
export class FlowIDEConnectionWatcher {
  _processFactory: () => Promise<?child_process$ChildProcess>;
  _ideConnectionCallback: ?FlowIDEConnection => mixed;
  _ideConnectionFactory: child_process$ChildProcess => FlowIDEConnection;

  _currentIDEConnection: ?FlowIDEConnection;
  _currentIDEConnectionSubscription: ?IDisposable;

  _isStarted: boolean;
  _isDisposed: boolean;

  constructor(
    processFactory: () => Promise<?child_process$ChildProcess>,
    ideConnectionCallback: ?FlowIDEConnection => mixed,
    // Can be injected for testing purposes
    ideConnectionFactory: child_process$ChildProcess => FlowIDEConnection =
        defaultIDEConnectionFactory,
  ) {
    this._processFactory = processFactory;
    this._ideConnectionFactory = ideConnectionFactory;
    this._currentIDEConnection = null;
    this._ideConnectionCallback = ideConnectionCallback;
    this._isDisposed = false;
    this._isStarted = false;
  }

  // Returns a promise which resolves when the first connection has been established, or we give up.
  start(): Promise<void> {
    if (!this._isStarted) {
      this._isStarted = true;
      return this._makeIDEConnection();
    } else {
      return Promise.resolve();
    }
  }

  async _makeIDEConnection(): Promise<void> {
    let proc = null;
    const endTimeMS = this._getTimeMS() + IDE_CONNECTION_MAX_WAIT_MS;
    while (true) {
      const attemptStartTime = this._getTimeMS();
      // eslint-disable-next-line no-await-in-loop
      proc = await this._processFactory();
      // dispose() could have been called while we were waiting for the above promise to resolve.
      if (this._isDisposed) {
        if (proc != null) {
          proc.kill();
        }
        return;
      }
      const attemptEndTime = this._getTimeMS();
      if (proc != null || attemptEndTime > endTimeMS) {
        break;
      } else {
        getLogger().info('Failed to start Flow IDE connection... retrying');
        const attemptWallTime = attemptEndTime - attemptStartTime;
        const additionalWaitTime = IDE_CONNECTION_MIN_INTERVAL_MS - attemptWallTime;
        if (additionalWaitTime > 0) {
          getLogger().info(`Waiting an additional ${additionalWaitTime} ms before retrying`);
          // eslint-disable-next-line no-await-in-loop
          await this._sleep(additionalWaitTime);
        }
      }
    }
    if (proc == null) {
      getLogger().error('Failed to start Flow IDE connection too many times... giving up');
      return;
    }
    const ideConnection = this._ideConnectionFactory(proc);
    this._ideConnectionCallback(ideConnection);
    this._currentIDEConnectionSubscription = ideConnection.onWillDispose(
      () => {
        this._ideConnectionCallback(null);
        this._makeIDEConnection();
      },
    );

    this._currentIDEConnection = ideConnection;
  }

  // Split this out just so it's easy to mock
  _getTimeMS(): number {
    return Date.now();
  }

  // Split this out just so it's easy to mock
  _sleep(ms: number): Promise<void> {
    return sleep(ms);
  }

  dispose(): void {
    if (!this._isDisposed) {
      this._isDisposed = true;
      if (this._currentIDEConnectionSubscription != null) {
        this._currentIDEConnectionSubscription.dispose();
      }
      if (this._currentIDEConnection != null) {
        this._currentIDEConnection.dispose();
      }
    }
  }
}
