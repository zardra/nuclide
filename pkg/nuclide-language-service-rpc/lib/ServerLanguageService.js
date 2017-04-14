/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {NuclideUri} from '../../commons-node/nuclideUri';
import type {FileVersion} from '../../nuclide-open-files-rpc/lib/rpc-types';
import type {TypeHint} from '../../nuclide-type-hint/lib/rpc-types';
import type {
  Definition,
  DefinitionQueryResult,
} from '../../nuclide-definition-service/lib/rpc-types';
import type {Outline} from '../../nuclide-outline-view/lib/rpc-types';
import type {CoverageResult} from '../../nuclide-type-coverage/lib/rpc-types';
import type {FindReferencesReturn} from '../../nuclide-find-references/lib/rpc-types';
import type {
  DiagnosticProviderUpdate,
  FileDiagnosticUpdate,
} from '../../nuclide-diagnostics-common/lib/rpc-types';
import type {
  Completion,
  SymbolResult,
  LanguageService,
} from '../../nuclide-language-service/lib/LanguageService';
import type {FileNotifier} from '../../nuclide-open-files-rpc/lib/rpc-types';
import type {ConnectableObservable} from 'rxjs';
import type {NuclideEvaluationExpression} from '../../nuclide-debugger-interfaces/rpc-types';
import type {CategoryLogger} from '../../nuclide-logging';

import invariant from 'assert';
import {getBufferAtVersion} from '../../nuclide-open-files-rpc';
import {FileCache} from '../../nuclide-open-files-rpc';
import {Observable} from 'rxjs';

// This is a version of the LanguageService interface which operates on a
// single modified file at a time. This provides a simplified interface
// for LanguageService implementors, at the cost of providing language analysis
// which can not reflect multiple edited files.
export type SingleFileLanguageService = {
  getDiagnostics(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
  ): Promise<?DiagnosticProviderUpdate>,

  observeDiagnostics(): Observable<FileDiagnosticUpdate>,

  getAutocompleteSuggestions(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
    position: atom$Point,
    activatedManually: boolean,
    prefix: string,
  ): Promise<?Array<Completion>>,

  getDefinition(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
    position: atom$Point,
  ): Promise<?DefinitionQueryResult>,

  getDefinitionById(
    file: NuclideUri,
    id: string,
  ): Promise<?Definition>,

  findReferences(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
    position: atom$Point,
  ): Promise<?FindReferencesReturn>,

  getCoverage(
    filePath: NuclideUri,
  ): Promise<?CoverageResult>,

  getOutline(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
  ): Promise<?Outline>,

  typeHint(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
    position: atom$Point,
  ): Promise<?TypeHint>,

  highlight(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
    position: atom$Point,
  ): Promise<?Array<atom$Range>>,

  formatSource(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
    range: atom$Range,
  ): Promise<?string>,

  formatEntireFile(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
    range: atom$Range,
  ): Promise<?{
    newCursor?: number,
    formatted: string,
  }>,

  getEvaluationExpression(
    filePath: NuclideUri,
    buffer: simpleTextBuffer$TextBuffer,
    position: atom$Point,
  ): Promise<?NuclideEvaluationExpression>,

  getProjectRoot(fileUri: NuclideUri): Promise<?NuclideUri>,

  isFileInProject(fileUri: NuclideUri): Promise<boolean>,

  dispose(): void,
};

export class ServerLanguageService<T: SingleFileLanguageService = SingleFileLanguageService> {
  _fileCache: FileCache;
  _service: T;

  constructor(fileNotifier: FileNotifier, service: T) {
    invariant(fileNotifier instanceof FileCache);
    this._fileCache = fileNotifier;
    this._service = service;
  }

  getSingleFileLanguageService(): T {
    return this._service;
  }

  async getDiagnostics(
    fileVersion: FileVersion,
  ): Promise<?DiagnosticProviderUpdate> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return null;
    }
    return this._service.getDiagnostics(filePath, buffer);
  }

  observeDiagnostics(): ConnectableObservable<FileDiagnosticUpdate> {
    return this._service.observeDiagnostics().publish();
  }

  async getAutocompleteSuggestions(
    fileVersion: FileVersion,
    position: atom$Point,
    activatedManually: boolean,
    prefix: string,
  ): Promise<?Array<Completion>> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return [];
    }
    return this._service.getAutocompleteSuggestions(
      filePath,
      buffer,
      position,
      activatedManually,
      prefix,
    );
  }

  async getDefinition(
    fileVersion: FileVersion,
    position: atom$Point,
  ): Promise<?DefinitionQueryResult> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return null;
    }
    return this._service.getDefinition(filePath, buffer, position);
  }

  getDefinitionById(
    file: NuclideUri,
    id: string,
  ): Promise<?Definition> {
    return this._service.getDefinitionById(file, id);
  }

  async findReferences(
    fileVersion: FileVersion,
    position: atom$Point,
  ): Promise<?FindReferencesReturn> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return null;
    }
    return this._service.findReferences(filePath, buffer, position);
  }

  getCoverage(
    filePath: NuclideUri,
  ): Promise<?CoverageResult> {
    return this._service.getCoverage(filePath);
  }

  async getOutline(
    fileVersion: FileVersion,
  ): Promise<?Outline> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return null;
    }
    return this._service.getOutline(filePath, buffer);
  }

  async typeHint(fileVersion: FileVersion, position: atom$Point): Promise<?TypeHint> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return null;
    }
    return this._service.typeHint(filePath, buffer, position);
  }

  async highlight(
    fileVersion: FileVersion,
    position: atom$Point,
  ): Promise<?Array<atom$Range>> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return [];
    }
    return this._service.highlight(filePath, buffer, position);
  }

  async formatSource(
    fileVersion: FileVersion,
    range: atom$Range,
  ): Promise<?string> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return null;
    }
    return this._service.formatSource(filePath, buffer, range);
  }

  async formatEntireFile(fileVersion: FileVersion, range: atom$Range): Promise<?{
    newCursor?: number,
    formatted: string,
  }> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return null;
    }
    return this._service.formatEntireFile(filePath, buffer, range);
  }

  async getEvaluationExpression(
    fileVersion: FileVersion,
    position: atom$Point,
  ): Promise<?NuclideEvaluationExpression> {
    const filePath = fileVersion.filePath;
    const buffer = await getBufferAtVersion(fileVersion);
    if (buffer == null) {
      return null;
    }
    return this._service.getEvaluationExpression(filePath, buffer, position);
  }

  supportsSymbolSearch(
    directories: Array<NuclideUri>,
  ): Promise<boolean> {
    return Promise.resolve(false);
    // A single-file language service by definition cannot offer
    // "project-wide symbol search". If you want your language to offer
    // symbols, you'll have to implement LanguageService directly.
  }

  symbolSearch(
    query: string,
    directories: Array<NuclideUri>,
  ): Promise<?Array<SymbolResult>> {
    return Promise.resolve(null);
  }

  getProjectRoot(fileUri: NuclideUri): Promise<?NuclideUri> {
    return this._service.getProjectRoot(fileUri);
  }

  async isFileInProject(fileUri: NuclideUri): Promise<boolean> {
    return this._service.isFileInProject(fileUri);
  }

  dispose(): void {
    this._service.dispose();
  }
}

// Assert that ServerLanguageService satisifes the LanguageService interface:
(((null: any): ServerLanguageService<>): LanguageService);

export function ensureInvalidations(
  logger: CategoryLogger,
  diagnostics: Observable<FileDiagnosticUpdate>,
): Observable<FileDiagnosticUpdate> {
  const filesWithErrors = new Set();
  const trackedDiagnostics: Observable<FileDiagnosticUpdate> =
    diagnostics
    .do((diagnostic: FileDiagnosticUpdate) => {
      const filePath = diagnostic.filePath;
      if (diagnostic.messages.length === 0) {
        logger.log(`Removing ${filePath} from files with errors`);
        filesWithErrors.delete(filePath);
      } else {
        logger.log(`Adding ${filePath} to files with errors`);
        filesWithErrors.add(filePath);
      }
    });

  const fileInvalidations: Observable<FileDiagnosticUpdate> =
    Observable.defer(() => {
      logger.log('Clearing errors after stream closed');
      return Observable.from(Array.from(filesWithErrors).map(file => {
        logger.log(`Clearing errors for ${file} after connection closed`);
        return {
          filePath: file,
          messages: [],
        };
      }));
    });

  return trackedDiagnostics.concat(fileInvalidations);
}
