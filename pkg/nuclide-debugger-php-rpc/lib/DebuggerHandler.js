/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import invariant from 'assert';
import {updateSettings} from './settings';
import {makeExpressionHphpdCompatible} from './utils';
import logger from './utils';
import {uriToPath, getBreakpointLocation} from './helpers';
import Handler from './Handler';
import {
  idOfFrame,
  functionOfFrame,
  fileUrlOfFrame,
  locationOfFrame,
} from './frame';
import {
  ConnectionStatus,
  COMMAND_STEP_INTO,
  COMMAND_STEP_OVER,
  COMMAND_STEP_OUT,
  BREAKPOINT_RESOLVED_NOTIFICATION,
} from './DbgpSocket';
import {
  ConnectionMultiplexerNotification,
  ConnectionMultiplexerStatus,
} from './ConnectionMultiplexer.js';

import FileCache from './FileCache';
import EventEmitter from 'events';
import {CompositeDisposable} from 'event-kit';
import type {Breakpoint} from './BreakpointStore';
import type {ConnectionMultiplexer} from './ConnectionMultiplexer';
import type {ClientCallback} from './ClientCallback';

const SESSION_END_EVENT = 'session-end-event';

// Handles all 'Debug.*' Chrome dev tools messages
export class DebuggerHandler extends Handler {
  _connectionMultiplexer: ConnectionMultiplexer;
  _files: FileCache;
  _emitter: EventEmitter;
  _subscriptions: CompositeDisposable;
  _hadFirstContinuationCommand: boolean;

  constructor(
    clientCallback: ClientCallback,
    connectionMultiplexer: ConnectionMultiplexer,
  ) {
    super('Debugger', clientCallback);

    this._hadFirstContinuationCommand = false;
    this._connectionMultiplexer = connectionMultiplexer;
    this._files = new FileCache(clientCallback);
    this._emitter = new EventEmitter();
    this._subscriptions = new CompositeDisposable(
      this._connectionMultiplexer.onStatus(
        this._onStatusChanged.bind(this),
      ),
      this._connectionMultiplexer.onNotification(
        this._onNotification.bind(this),
      ),
    );
  }

  onSessionEnd(callback: () => void): void {
    logger.log('onSessionEnd');
    this._emitter.on(SESSION_END_EVENT, callback);
  }

  async handleMethod(id: number, method: string, params: Object): Promise<any> {
    switch (method) {
      // TODO: Add Console (aka logging) support
      case 'enable':
        this._debuggerEnable(id);
        break;

      case 'pause':
        this._pause();
        break;

      case 'stepInto':
        this._sendContinuationCommand(COMMAND_STEP_INTO);
        break;

      case 'stepOut':
        this._sendContinuationCommand(COMMAND_STEP_OUT);
        break;

      case 'stepOver':
        this._sendContinuationCommand(COMMAND_STEP_OVER);
        break;

      case 'resume':
        this._resume();
        break;

      case 'setPauseOnExceptions':
        await this._setPauseOnExceptions(id, params);
        break;

      case 'setAsyncCallStackDepth':
      case 'skipStackFrames':
        this.replyWithError(id, 'Not implemented');
        break;

      case 'getScriptSource':
        // TODO: Handle file read errors.
        // TODO: Handle non-file scriptIds
        this.replyToCommand(id, {scriptSource: await this._files.getFileSource(params.scriptId)});
        break;

      case 'setBreakpointByUrl':
        this._setBreakpointByUrl(id, params);
        break;

      case 'removeBreakpoint':
        await this._removeBreakpoint(id, params);
        break;

      case 'evaluateOnCallFrame':
        const compatParams = makeExpressionHphpdCompatible(params);
        const result = await this._connectionMultiplexer.evaluateOnCallFrame(
          Number(compatParams.callFrameId),
          compatParams.expression,
        );
        this.replyToCommand(id, result);
        break;

      case 'selectThread':
        this._selectThread(params);
        break;

      case 'setDebuggerSettings':
        updateSettings(params);
        break;

      default:
        this.unknownMethod(id, method, params);
        break;
    }
  }

  async _selectThread(params: Object): Promise<void> {
    const {threadId} = params;
    await this._connectionMultiplexer.selectThread(threadId);
    this._sendPausedMessage();
  }

  async _setPauseOnExceptions(id: number, params: Object): Promise<any> {
    const {state} = params;
    await this._connectionMultiplexer.getBreakpointStore().setPauseOnExceptions(String(id), state);
    this.replyToCommand(id, {});
  }

  async _setBreakpointByUrl(id: number, params: Object): Promise<void> {
    const {lineNumber, url, columnNumber, condition} = params;
    if (!url || columnNumber !== 0) {
      this.replyWithError(id, 'Invalid arguments to Debugger.setBreakpointByUrl: '
        + JSON.stringify(params));
      return;
    }
    this._files.registerFile(url);

    const path = uriToPath(url);
    const breakpointStore = this._connectionMultiplexer.getBreakpointStore();
    // Chrome lineNumber is 0-based while xdebug lineno is 1-based.
    const breakpointId = await breakpointStore.setFileLineBreakpoint(
      String(id),
      path,
      lineNumber + 1,
      condition,
    );
    const breakpoint = await breakpointStore.getBreakpoint(breakpointId);
    invariant(breakpoint != null);
    this.replyToCommand(id, {
      breakpointId,
      resolved: breakpoint.resolved,
      locations: [
        getBreakpointLocation(breakpoint),
      ],
    });
  }

  async _removeBreakpoint(id: number, params: Object): Promise<any> {
    const {breakpointId} = params;
    await this._connectionMultiplexer.removeBreakpoint(breakpointId);
    this.replyToCommand(id, {id: breakpointId});
  }

  _debuggerEnable(id: number): void {
    this.replyToCommand(id, {});
    this._sendFakeLoaderBreakpoint();
  }

  async _getStackFrames(id: number): Promise<Array<Object>> {
    const frames =
        await this._connectionMultiplexer.getConnectionStackFrames(id);

    if (frames != null && frames.stack != null || frames.stack.length === 0) {
      return Promise.all(
        frames.stack.map((frame, frameIndex) => this._convertFrame(frame, frameIndex)));
    }

    return Promise.resolve([]);
  }

  async _getTopFrameForConnection(id: number): Promise<?Object> {
    const frames = await this._connectionMultiplexer.getConnectionStackFrames(id);
    if (frames == null || frames.stack == null || frames.stack.length === 0) {
      return null;
    }
    return this._convertFrame(frames.stack[0], 0);
  }

  async _convertFrame(frame: Object, frameIndex: number): Promise<Object> {
    logger.log('Converting frame: ' + JSON.stringify(frame));
    const file = this._files.registerFile(fileUrlOfFrame(frame));
    const location = locationOfFrame(frame);
    const hasSource = await file.hasSource();
    if (!hasSource) {
      location.scriptId = '';
    }

    let scopeChain = null;
    try {
      scopeChain = await this._connectionMultiplexer.getScopesForFrame(frameIndex);
    } catch (e) {
      // Couldn't get scopes.
    }

    return {
      callFrameId: idOfFrame(frame),
      functionName: functionOfFrame(frame),
      location,
      scopeChain,
    };
  }

  _sendContinuationCommand(command: string): void {
    logger.log('Sending continuation command: ' + command);
    this._connectionMultiplexer.sendContinuationCommand(command);
  }

  _pause(): void {
    this._connectionMultiplexer.pause();
  }

  _resume(): void {
    if (!this._hadFirstContinuationCommand) {
      this._hadFirstContinuationCommand = true;
      this.sendMethod('Debugger.resumed');
      this._subscriptions.add(this._connectionMultiplexer.listen(this._endSession.bind(this)));
      return;
    }
    this._connectionMultiplexer.resume();
  }

  async _onStatusChanged(status: string, params: ?Object): Promise<void> {
    logger.log('Sending status: ' + status);
    switch (status) {
      case ConnectionMultiplexerStatus.AllConnectionsPaused:
      case ConnectionMultiplexerStatus.SingleConnectionPaused:
        await this._sendPausedMessage();
        break;
      case ConnectionMultiplexerStatus.Running:
        this.sendMethod('Debugger.resumed');
        break;
      case ConnectionMultiplexerStatus.End:
        this._endSession();
        break;
      default:
        logger.logErrorAndThrow('Unexpected status: ' + status);
    }
  }

  async _onNotification(notifyName: string, params: ?Object): Promise<void> {
    switch (notifyName) {
      case BREAKPOINT_RESOLVED_NOTIFICATION:
        invariant(params);
        const breakpoint: Breakpoint = params;
        this.sendMethod('Debugger.breakpointResolved', {
          breakpointId: breakpoint.chromeId,
          location: getBreakpointLocation(breakpoint),
        });
        break;
      case ConnectionMultiplexerNotification.RequestUpdate:
        invariant(params);
        const frame = params.status === ConnectionStatus.Break ?
          await this._getTopFrameForConnection(params.id) : null;
        this.sendMethod('Debugger.threadUpdated', {
          thread: {
            id: String(params.id),
            name: String(params.id),
            address: frame != null ? frame.functionName : 'N/A',
            location: frame != null ? frame.location : null,
            hasSource: true,
            stopReason: params.stopReason,
            description: 'N/A',
          },
        });
        break;
      default:
        logger.logErrorAndThrow(`Unexpected notification: ${notifyName}`);
    }
  }

  // May only call when in paused state.
  async _sendPausedMessage(): Promise<any> {
    const requestSwitchMessage = this._connectionMultiplexer.getRequestSwitchMessage();
    this._connectionMultiplexer.resetRequestSwitchMessage();
    if (requestSwitchMessage != null) {
      this.sendUserMessage('outputWindow', {
        level: 'info',
        text: requestSwitchMessage,
      });
    }
    const enabledConnectionId = this._connectionMultiplexer.getEnabledConnectionId();
    this.sendMethod(
      'Debugger.paused',
      {
        callFrames: enabledConnectionId != null ?
          await this._getStackFrames(enabledConnectionId) : [],
        reason: 'breakpoint', // TODO: better reason?
        threadSwitchMessage: requestSwitchMessage,
        data: {},
        stopThreadId: enabledConnectionId,
      },
    );

    // Send an update for the enabled thread to cause the request window in the
    // front-end to update.
    if (enabledConnectionId != null) {
      const frame = await this._getTopFrameForConnection(enabledConnectionId);
      this.sendMethod('Debugger.threadUpdated', {
        thread: {
          id: String(enabledConnectionId),
          name: String(enabledConnectionId),
          address: frame != null ? frame.functionName : 'N/A',
          location: frame != null ? frame.location : null,
          hasSource: true,
          stopReason: this._connectionMultiplexer.getConnectionStopReason(enabledConnectionId),
          description: 'N/A',
        },
      });
    }
  }

  _sendFakeLoaderBreakpoint(): void {
    this.sendMethod(
      'Debugger.paused',
      {
        callFrames: [],
        reason: 'initial break',
        data: {},
      });
  }

  _endSession(): void {
    logger.log('DebuggerHandler: Ending session');
    this._subscriptions.dispose();
    this._emitter.emit(SESSION_END_EVENT);
  }
}
