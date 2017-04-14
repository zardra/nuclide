/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import {checkOutput} from '../../commons-node/process';
import nuclideUri from '../../commons-node/nuclideUri';
import os from 'os';

import type {DebugBridgeType} from './DebugBridgeService';

const cachedPids: { [DebugBridgeType]: ?{ pid: string, path: ?string } } = {
  adb: null,
  sdb: null,
};
const cachedCommandExists = new Map();

class PosixRunningDbFinder {
  _db: DebugBridgeType;

  constructor(db: DebugBridgeType) {
    this._db = db;
  }

  _doesCommandExist(command: string): Promise<boolean> {
    let cached = cachedCommandExists.get(command);
    if (cached == null) {
      // this is very fast because command is a builtin
      cached = checkOutput('command', ['-v', command]).then(proc => proc.exitCode === 0);
      cachedCommandExists.set(command, cached);
    }
    return cached;
  }

  _getListenAddress(): string {
    switch (this._db) {
      case 'adb':
        return '127.0.0.1:5037';
      case 'sdb':
        return '*:26099';
    }
    throw new Error('unreachable');
  }

  async _findPidOfRunningDb(): Promise<?string> {
    if (!await this._doesCommandExist('lsof')) {
      return null;
    }
    return (await checkOutput('lsof', ['-n'])).stdout
     .split(/\n+/g)
     .filter(line => line.includes(this._getListenAddress()) && line.includes('LISTEN'))
     .map(line => line.split(' ').filter(s => s.length > 0)[1])[0];
  }

  async _findDbPath(pid: string): Promise<?string> {
    throw new Error('not implemented');
  }

  async _isDbRunning(pid?: string): Promise<boolean> {
    return (await checkOutput('ps', ['-A', '-o', 'pid,command'])).stdout
     .split(/\n+/g)
     .some(line => (pid == null || line.trim().startsWith(`${pid} `))
                   && line.includes(` ${this._db} `)
                   && line.includes(' fork-server '));
  }

  async findRunningDbPath(): Promise<?string> {
    if (!await this._isDbRunning()) {
      cachedPids[this._db] = null;
      return null;
    }
    const cached = cachedPids[this._db];
    // Best effort, if an adb is running with the same cached pid, we return that path
    if (cached != null && await this._isDbRunning(cached.pid)) {
      return cached.path;
    }
    // This is very slow compared to the other operations, so we do it only when we know an adb is
    // running
    const pid = await this._findPidOfRunningDb();
    const path = pid == null ? null : await this._findDbPath(pid);
    cachedPids[this._db] = pid == null ? null : {pid, path};
    return path;
  }
}

class DarwinRunningDbFinder extends PosixRunningDbFinder {
  async _findDbPath(pid: string): Promise<?string> {
    const runningProcess = (await checkOutput('vmmap', [pid])).stdout
      .split(/\n+/g)
      .find(line => line.includes('__TEXT'));
    if (runningProcess != null) {
      const path = runningProcess.split(' ').filter(s => s.length > 0).slice(-1)[0];
      if (path != null && path.length > 0) {
        return path;
      }
    }
  }
}

class LinuxRunningDbFinder extends PosixRunningDbFinder {
  async _findDbPath(pid: string): Promise<?string> {
    if (!await this._doesCommandExist('readlink')) {
      return null;
    }
    return (await checkOutput('readlink', [nuclideUri.join('/proc', pid, 'exe')])).stdout
      .split(' ').filter(s => s.length > 0)[0];
  }
}

export function findRunningDbPath(db: DebugBridgeType): Promise<?string> {
  switch (os.type()) {
    case 'Darwin':
      return new DarwinRunningDbFinder(db).findRunningDbPath();
    case 'Linux':
      return new LinuxRunningDbFinder(db).findRunningDbPath();
    default:
      return Promise.resolve(null);
  }
}
