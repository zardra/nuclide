/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {FlowStatusOutput} from './flowOutputTypes';

import {Disposable} from 'event-kit';
import {Observable} from 'rxjs';
import * as rpc from 'vscode-jsonrpc';
import through from 'through';

import UniversalDisposable from '../../commons-node/UniversalDisposable';
import {track} from '../../nuclide-analytics';
import {getLogger} from '../../nuclide-logging';

// TODO put these in flow-typed when they are fleshed out better

type MessageHandler = (...args: any) => mixed;

type RpcConnection = {
  onNotification(methodName: string, handler: MessageHandler): void,
  sendNotification(methodName: string, ...args: any): void,
  // TODO requests
  listen(): void,
  dispose(): void,
};

const SUBSCRIBE_METHOD_NAME = 'subscribeToDiagnostics';

const NOTIFICATION_METHOD_NAME = 'diagnosticsNotification';

const SUBSCRIBE_RETRY_INTERVAL = 5000;
const SUBSCRIBE_RETRIES = 10;

// Manages the connection to a single `flow ide` process. The lifecycle of an instance of this class
// is tied to the lifecycle of a the `flow ide` process.
export class FlowIDEConnection {
  _connection: RpcConnection;
  _ideProcess: child_process$ChildProcess;
  _disposables: UniversalDisposable;

  // Because vscode-jsonrpc offers no mechanism to unsubscribe from notifications, we have to make
  // sure that we put a bound on the number of times we add subscriptions, otherwise we could have a
  // memory leak. The most sensible bound is to just allow a single subscription per message type.
  // Therefore, we must have singleton observables rather than returning new instances from method
  // calls.
  _diagnostics: Observable<FlowStatusOutput>;

  constructor(
    process: child_process$ChildProcess,
  ) {
    this._disposables = new UniversalDisposable();
    this._ideProcess = process;
    this._ideProcess.stderr.pipe(through(
      msg => {
        getLogger().info('Flow IDE process stderr: ', msg.toString());
      },
    ));
    this._connection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this._ideProcess.stdout),
      new rpc.StreamMessageWriter(this._ideProcess.stdin),
    );
    this._connection.listen();

    this._ideProcess.on('exit', () => this.dispose());
    this._ideProcess.on('close', () => this.dispose());

    this._diagnostics = Observable.fromEventPattern(
      handler => {
        this._connection.onNotification(NOTIFICATION_METHOD_NAME, (errors: FlowStatusOutput) => {
          handler(errors);
        });
      },
      // no-op: vscode-jsonrpc offers no way to unsubscribe
      () => {},
    ).publishReplay(1);
    this._disposables.add(this._diagnostics.connect());

    this._disposables.add(() => {
      this._ideProcess.stdin.end();
      this._ideProcess.kill();

      this._connection.dispose();
    });
  }

  dispose(): void {
    this._disposables.dispose();
  }

  onWillDispose(callback: () => mixed): IDisposable {
    this._disposables.add(callback);
    return new Disposable(() => {
      this._disposables.remove(callback);
    });
  }

  observeDiagnostics(): Observable<FlowStatusOutput> {
    const subscribe = () => {
      this._connection.sendNotification(SUBSCRIBE_METHOD_NAME);
      // This is a temporary hack used to simplify the temporary vscode-jsonrpc implementation in
      // Flow: D4659335
      // TODO remove this hack sometime after Flow v0.44 is released (D4798007)
      this._ideProcess.stdin.write('\r\n');
    };

    const retrySubscription = Observable.interval(SUBSCRIBE_RETRY_INTERVAL)
      .take(SUBSCRIBE_RETRIES)
      .takeUntil(this._diagnostics)
      .subscribe(() => {
        getLogger().error(
          'Did not receive diagnostics after subscribe request -- retrying...',
        );
        track('nuclide-flow.missing-push-diagnostics');
        subscribe();
      });

    subscribe();
    return Observable.using(
      () => retrySubscription,
      () => this._diagnostics,
    );
  }
}
