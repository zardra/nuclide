/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {Provider} from '../../nuclide-quick-open/lib/types';

import invariant from 'assert';
import {CompositeDisposable} from 'atom';
// eslint-disable-next-line nuclide-internal/no-cross-atom-imports
import {BusySignalProviderBase} from '../../nuclide-busy-signal';
import createPackage from '../../commons-atom/createPackage';
import scheduleIdleCallback from '../../commons-node/scheduleIdleCallback';
import {getFuzzyFileSearchServiceByNuclideUri} from '../../nuclide-remote-connection';
import {RpcTimeoutError} from '../../nuclide-rpc';
import {getLogger} from '../../nuclide-logging';
import FuzzyFileNameProvider from './FuzzyFileNameProvider';
import {getIgnoredNames} from './utils';

const logger = getLogger();

class Activation {
  _busySignalProvider: BusySignalProviderBase;
  _subscriptions: CompositeDisposable;
  _subscriptionsByRoot: Map<string, CompositeDisposable>;

  constructor() {
    this._busySignalProvider = new BusySignalProviderBase();
    this._subscriptions = new CompositeDisposable();
    this._subscriptionsByRoot = new Map();

    (this: any)._readySearch = this._readySearch.bind(this);

    // Do search preprocessing for all existing and future root directories.
    this._readySearch(atom.project.getPaths());
    this._subscriptions.add(
      atom.project.onDidChangePaths(this._readySearch),
    );
  }

  _readySearch(projectPaths: Array<string>): void {
    // Add new project roots.
    for (const projectPath of projectPaths) {
      if (!this._subscriptionsByRoot.has(projectPath)) {
        const disposables = new CompositeDisposable(
          // Wait a bit before starting the initial search, since it's a heavy op.
          scheduleIdleCallback(() => {
            this._initialSearch(projectPath).catch(err => {
              // RPC timeout errors can often happen here, but don't dispose the search.
              if (err instanceof RpcTimeoutError) {
                logger.warn(`Warmup fuzzy filename search for ${projectPath} hit the RPC timeout.`);
              } else {
                logger.error(`Error starting fuzzy filename search for ${projectPath}: ${err}`);
                this._disposeSearch(projectPath);
              }
            });
          }, {timeout: 5000}),
        );
        this._subscriptionsByRoot.set(projectPath, disposables);
      }
    }

    // Clean up removed project roots.
    for (const [projectPath] of this._subscriptionsByRoot) {
      if (!projectPaths.includes(projectPath)) {
        this._disposeSearch(projectPath);
      }
    }
  }

  async _initialSearch(projectPath: string): Promise<void> {
    const service = getFuzzyFileSearchServiceByNuclideUri(projectPath);
    const isAvailable = await service.isFuzzySearchAvailableFor(projectPath);
    if (!isAvailable) {
      throw new Error('Nonexistent directory');
    }

    const disposables = this._subscriptionsByRoot.get(projectPath);
    invariant(disposables != null);

    const busySignalDisposable =
      this._busySignalProvider.displayMessage(`File search: indexing ${projectPath}`);
    disposables.add(busySignalDisposable);

    // It doesn't matter what the search term is. Empirically, doing an initial
    // search speeds up the next search much more than simply doing the setup
    // kicked off by 'fileSearchForDirectory'.
    try {
      await service.queryFuzzyFile(projectPath, 'a', getIgnoredNames());
    } catch (err) {
      throw err;
    } finally {
      busySignalDisposable.dispose();
      disposables.remove(busySignalDisposable);
    }
  }

  _disposeSearch(projectPath: string): void {
    try {
      const service = getFuzzyFileSearchServiceByNuclideUri(projectPath);
      service.disposeFuzzySearch(projectPath);
    } catch (err) {
      logger.error(`Error disposing fuzzy filename service for ${projectPath}`, err);
    } finally {
      const disposables = this._subscriptionsByRoot.get(projectPath);
      if (disposables != null) {
        disposables.dispose();
        this._subscriptionsByRoot.delete(projectPath);
      }
    }
  }

  registerProvider(): Provider {
    return FuzzyFileNameProvider;
  }

  provideBusySignal(): BusySignalProviderBase {
    return this._busySignalProvider;
  }

  dispose(): void {
    this._subscriptions.dispose();
    this._subscriptionsByRoot.forEach(disposables => disposables.dispose());
    this._subscriptionsByRoot.clear();
  }
}

createPackage(module.exports, Activation);
