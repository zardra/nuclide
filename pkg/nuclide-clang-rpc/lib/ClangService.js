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
import typeof * as ClangProcessService from './ClangProcessService';
import type {
  ClangCompileResult,
  ClangCompletion,
  ClangCursor,
  ClangDeclaration,
  ClangLocalReferences,
  ClangOutlineTree,
} from './rpc-types';
import type {ConnectableObservable} from 'rxjs';

import {keyMirror} from '../../commons-node/collection';
import {Observable} from 'rxjs';
import {checkOutput} from '../../commons-node/process';
import ClangServerManager from './ClangServerManager';

const serverManager = new ClangServerManager();

// Maps clang's cursor types to the actual declaration types: for a full list see
// https://github.com/llvm-mirror/clang/blob/master/include/clang/Basic/DeclNodes.td
//
// Keep in sync with the clang Python binding (../fb/lib/python/clang/cindex.py)
// The order of the keys matches the ordering in cindex.py.
export const ClangCursorToDeclarationTypes = Object.freeze({
  UNEXPOSED_DECL: '',
  STRUCT_DECL: 'Record',
  UNION_DECL: 'Record',
  CLASS_DECL: 'CXXRecord',
  ENUM_DECL: 'Enum',
  FIELD_DECL: 'Field',
  ENUM_CONSTANT_DECL: 'EnumConstant',
  FUNCTION_DECL: 'Function',
  VAR_DECL: 'Var',
  PARM_DECL: 'ParmVar',
  OBJC_INTERFACE_DECL: 'ObjCInterface',
  OBJC_CATEGORY_DECL: 'ObjCCategory',
  OBJC_PROTOCOL_DECL: 'ObjCProtocol',
  OBJC_PROPERTY_DECL: 'ObjCProperty',
  OBJC_IVAR_DECL: 'ObjCIVar',
  OBJC_INSTANCE_METHOD_DECL: 'ObjCMethod',
  OBJC_CLASS_METHOD_DECL: 'ObjCMethod',
  OBJC_IMPLEMENTATION_DECL: 'ObjCImplementation',
  OBJC_CATEGORY_IMPL_DECL: 'ObjCCategoryImpl',
  TYPEDEF_DECL: 'Typedef',
  CXX_METHOD: 'CXXMethod',
  NAMESPACE: 'Namespace',
  LINKAGE_SPEC: 'LinkageSpec',
  CONSTRUCTOR: 'CXXConstructor',
  DESTRUCTOR: 'CXXDestructor',
  CONVERSION_FUNCTION: 'CXXConversion',
  TEMPLATE_TYPE_PARAMETER: 'TemplateTypeParm',
  TEMPLATE_NON_TYPE_PARAMETER: 'NonTypeTemplateParm',
  TEMPLATE_TEMPLATE_PARAMETER: 'TemplateTemplateParm',
  FUNCTION_TEMPLATE: 'FunctionTemplate',
  CLASS_TEMPLATE: 'ClassTemplate',
  CLASS_TEMPLATE_PARTIAL_SPECIALIZATION: 'ClassTemplatePartialSpecialization',
  NAMESPACE_ALIAS: 'NamespaceAlias',
  USING_DIRECTIVE: 'UsingDirective',
  USING_DECLARATION: 'Using',
  TYPE_ALIAS_DECL: 'TypeAlias',
  OBJC_SYNTHESIZE_DECL: 'ObjCSynthesize',
  OBJC_DYNAMIC_DECL: 'ObjCDynamic',
  CXX_ACCESS_SPEC_DECL: 'AccessSpec',
  OVERLOAD_CANDIDATE: 'Function',
  MACRO_DEFINITION: 'Macro',
});

export const ClangCursorTypes = keyMirror(ClangCursorToDeclarationTypes);

async function getClangService(
  src: NuclideUri,
  contents: string,
  compilationDBFile: ?NuclideUri,
  defaultFlags: ?Array<string>,
  blocking?: boolean,
): Promise<?ClangProcessService> {
  const server = serverManager.getClangServer(src, contents, compilationDBFile, defaultFlags);
  if (!server.isReady()) {
    if (blocking) {
      await server.waitForReady();
    } else {
      return null;
    }
  }
  // It's possible that the server got disposed while waiting.
  if (server.isDisposed()) {
    return null;
  }
  return server.getService();
}

/**
 * Compiles the specified source file (automatically determining the correct compilation flags).
 * It currently returns an Observable just to circumvent the 60s service timeout for Promises.
 * TODO(9519963): Stream back more detailed compile status message.
 */
export function compile(
  src: NuclideUri,
  contents: string,
  compilationDBFile: ?NuclideUri,
  defaultFlags?: ?Array<string>,
): ConnectableObservable<?ClangCompileResult> {
  const doCompile = async () => {
    // Note: restarts the server if the flags changed.
    const server = serverManager.getClangServer(
      src,
      contents,
      compilationDBFile,
      defaultFlags,
      true,
    );
    if (!server.isDisposed()) {
      return server.compile(contents);
    }
  };
  return Observable.fromPromise(doCompile()).publish();
}

export async function getCompletions(
  src: NuclideUri,
  contents: string,
  line: number,
  column: number,
  tokenStartColumn: number,
  prefix: string,
  compilationDBFile: ?NuclideUri,
  defaultFlags?: ?Array<string>,
): Promise<?Array<ClangCompletion>> {
  const service = await getClangService(src, contents, compilationDBFile, defaultFlags);
  if (service != null) {
    return service.get_completions(
      contents,
      line,
      column,
      tokenStartColumn,
      prefix,
    );
  }
}

export async function getDeclaration(
  src: NuclideUri,
  contents: string,
  line: number,
  column: number,
  compilationDBFile: ?NuclideUri,
  defaultFlags?: ?Array<string>,
): Promise<?ClangDeclaration> {
  const service = await getClangService(src, contents, compilationDBFile, defaultFlags);
  if (service != null) {
    return service.get_declaration(
      contents,
      line,
      column,
    );
  }
}

// Fetches information for a declaration and all its parents.
// The first element in info will be for the declaration itself,
// the second will be for its direct semantic parent (if it exists), etc.
export async function getDeclarationInfo(
  src: NuclideUri,
  contents: string,
  line: number,
  column: number,
  compilationDBFile: ?NuclideUri,
  defaultFlags: ?Array<string>,
): Promise<?Array<ClangCursor>> {
  const service = await getClangService(src, contents, compilationDBFile, defaultFlags);
  if (service != null) {
    return service.get_declaration_info(
      contents,
      line,
      column,
    );
  }
}

export async function getRelatedSourceOrHeader(
  src: NuclideUri,
  compilationDBFile: ?NuclideUri,
): Promise<?NuclideUri> {
  return serverManager.getClangFlagsManager().getRelatedSrcFileForHeader(src, compilationDBFile);
}

export async function getOutline(
  src: NuclideUri,
  contents: string,
  compilationDBFile: ?NuclideUri,
  defaultFlags: ?Array<string>,
): Promise<?Array<ClangOutlineTree>> {
  const service = await getClangService(src, contents, compilationDBFile, defaultFlags, true);
  if (service != null) {
    return service.get_outline(contents);
  }
}

export async function getLocalReferences(
  src: NuclideUri,
  contents: string,
  line: number,
  column: number,
  compilationDBFile: ?NuclideUri,
  defaultFlags: ?Array<string>,
): Promise<?ClangLocalReferences> {
  const service = await getClangService(src, contents, compilationDBFile, defaultFlags, true);
  if (service != null) {
    return service.get_local_references(contents, line, column);
  }
}

export async function formatCode(
  src: NuclideUri,
  contents: string,
  cursor: number,
  offset?: number,
  length?: number,
): Promise<{newCursor: number, formatted: string}> {
  const args = [
    '-style=file',
    `-assume-filename=${src}`,
    `-cursor=${cursor}`,
  ];
  if (offset != null) {
    args.push(`-offset=${offset}`);
  }
  if (length != null) {
    args.push(`-length=${length}`);
  }
  const {stdout} = await checkOutput('clang-format', args, {stdin: contents});

  // The first line is a JSON blob indicating the new cursor position.
  const newLine = stdout.indexOf('\n');
  return {
    newCursor: JSON.parse(stdout.substring(0, newLine)).Cursor,
    formatted: stdout.substring(newLine + 1),
  };
}

/**
 * Kill the Clang server for a particular source file,
 * as well as all the cached compilation flags.
 * If no file is provided, all servers are reset.
 */
export function reset(src?: NuclideUri): void {
  serverManager.reset(src);
}

export function dispose(): void {
  serverManager.dispose();
}
