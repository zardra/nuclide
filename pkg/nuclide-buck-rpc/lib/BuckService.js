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
import type {AsyncExecuteOptions} from '../../commons-node/process';
import type {ProcessMessage} from '../../commons-node/process-rpc-types';
import type {ConnectableObservable} from 'rxjs';

import {
  asyncExecute,
  checkOutput,
  observeProcess,
  getOriginalEnvironment,
} from '../../commons-node/process';
import {PromisePool} from '../../commons-node/promise-executors';
import fsPromise from '../../commons-node/fsPromise';
import nuclideUri from '../../commons-node/nuclideUri';
import {Observable} from 'rxjs';
import createBuckWebSocket from './createBuckWebSocket';
import {getLogger} from '../../nuclide-logging';
import ini from 'ini';
import {quote} from 'shell-quote';

const logger = getLogger();

// Tag these Buck calls as coming from Nuclide for analytics purposes.
const CLIENT_ID_ARGS = ['--config', 'client.id=nuclide'];

export const MULTIPLE_TARGET_RULE_TYPE = 'multiple_targets';

export type BuckWebSocketMessage =
  | {
      // Not actually from Buck - this is to let the receiver know that the socket is connected.
      type: 'SocketConnected',
    }
  | {
      type: 'BuildProgressUpdated',
      progressValue: number,
    }
  | {
      type: 'BuildFinished',
      exitCode: number,
    }
  | {
      type: 'BuildStarted',
    }
  | {
      type: 'ConsoleEvent',
      message: string,
      level: {
        name:
          | 'OFF'
          | 'SEVERE'
          | 'WARNING'
          | 'INFO'
          | 'CONFIG'
          | 'FINE'
          | 'FINER'
          | 'FINEST'
          | 'ALL',
      },
    }
  | {
      type: 'ParseStarted',
    }
  | {
      type: 'ParseFinished',
    }
  | {
      type: 'InstallFinished',
      success: boolean,
      pid?: number,
    }
  | {
      type: 'RunStarted',
    }
  | {
      type: 'RunComplete',
    }
  | {
      type: 'ResultsAvailable',
      results: {
        buildTarget: {
          shortName: string,
          baseName: string,
        },
        success: boolean,
        failureCount: number,
        totalNumberOfTests: number,
        testCases: Array<{
          success: boolean,
          failureCount: number,
          skippedCount: number,
          testCaseName: string,
          testResults: Array<{
            testCaseName: string,
            testName: string,
            type: string,
            time: number,
            message: string,
            stacktrace: ?string,
            stdOut: string,
            stdErr: string,
          }>,
        }>,
      },
    }
  | {
      type: 'CompilerErrorEvent',
      error: string,
      suggestions: Array<mixed>, // TODO: use this?
      compilerType: string,
    };

type BuckConfig = Object;
export type BaseBuckBuildOptions = {
  install?: boolean,
  run?: boolean,
  test?: boolean,
  debug?: boolean,
  simulator?: ?string,
  // The service framework doesn't support imported types
  commandOptions?: Object /* AsyncExecuteOptions */,
  extraArguments?: Array<string>,
};
type FullBuckBuildOptions = {
  baseOptions: BaseBuckBuildOptions,
  pathToBuildReport?: string,
  buildTargets: Array<string>,
};
type BuckCommandAndOptions = {
  pathToBuck: string,
  buckCommandOptions: AsyncExecuteOptions,
};

export type CommandInfo = {
  timestamp: number,
  command: string,
  args: Array<string>,
};

export type ResolvedBuildTarget = {
  qualifiedName: string,
  flavors: Array<string>,
};

export type ResolvedRuleType = {
  type: string,
  buildTarget: ResolvedBuildTarget,
};

/**
 * As defined in com.facebook.buck.cli.Command, some of Buck's subcommands are
 * read-only. The read-only commands can be executed in parallel, but the rest
 * must be executed serially.
 *
 * Still, we try to make sure we don't slow down the user's computer.
 *
 * TODO(hansonw): Buck seems to have some race conditions that prevent us
 * from running things in parallel :(
 */
const MAX_CONCURRENT_READ_ONLY = 1; // Math.max(1, os.cpus().length - 1);
const pools = new Map();

function getPool(path: string, readOnly: boolean): PromisePool {
  const key = (readOnly ? 'ro:' : '') + path;
  let pool = pools.get(key);
  if (pool != null) {
    return pool;
  }
  pool = new PromisePool(readOnly ? MAX_CONCURRENT_READ_ONLY : 1);
  pools.set(key, pool);
  return pool;
}

/**
 * Given a file path, returns path to the Buck project root i.e. the directory containing
 * '.buckconfig' file.
 */
export function getRootForPath(file: NuclideUri): Promise<?NuclideUri> {
  return fsPromise.findNearestFile('.buckconfig', file);
}

/**
 * Gets the build file for the specified target.
 */
export async function getBuildFile(
  rootPath: NuclideUri,
  targetName: string,
): Promise<?string> {
  try {
    const result = await query(rootPath, `buildfile(${targetName})`);
    if (result.length === 0) {
      return null;
    }
    return nuclideUri.join(rootPath, result[0]);
  } catch (e) {
    logger.error(`No build file for target "${targetName}" ${e}`);
    return null;
  }
}

/**
 * @param args Do not include 'buck' as the first argument: it will be added
 *     automatically.
 */
async function _runBuckCommandFromProjectRoot(
  rootPath: string,
  args: Array<string>,
  commandOptions?: AsyncExecuteOptions,
  addClientId?: boolean = true,
  readOnly?: boolean = true,
): Promise<{stdout: string, stderr: string, exitCode?: number}> {
  const {
    pathToBuck,
    buckCommandOptions: options,
  } = await _getBuckCommandAndOptions(rootPath, commandOptions);

  const newArgs = addClientId ? args.concat(CLIENT_ID_ARGS) : args;
  logger.debug('Buck command:', pathToBuck, newArgs, options);
  return getPool(rootPath, readOnly).submit(() =>
    checkOutput(pathToBuck, newArgs, options));
}

/**
 * @return The path to buck and set of options to be used to run a `buck` command.
 */
async function _getBuckCommandAndOptions(
  rootPath: string,
  commandOptions?: AsyncExecuteOptions = {},
): Promise<BuckCommandAndOptions> {
  // $UPFixMe: This should use nuclide-features-config
  const pathToBuck = (global.atom &&
    global.atom.config.get('nuclide.nuclide-buck.pathToBuck')) ||
    'buck';
  const buckCommandOptions = {
    cwd: rootPath,
    // Buck restarts itself if the environment changes, so try to preserve
    // the original environment that Nuclide was started in.
    env: await getOriginalEnvironment(),
    ...commandOptions,
  };
  return {pathToBuck, buckCommandOptions};
}

/**
 * Returns an array of strings (that are build targets) by running:
 *
 *     buck query owner(<path>)
 *
 * If `kindFilter` is provided, `kind(kindFilter, owner(..))` will be used.
 *
 * @param filePath absolute path or a local or a remote file.
 * @param kindFilter filter for specific build target kinds.
 * @return Promise that resolves to an array of build targets.
 */
export async function getOwners(
  rootPath: NuclideUri,
  filePath: NuclideUri,
  kindFilter?: string,
): Promise<Array<string>> {
  let queryString = `owner(${quote([filePath])})`;
  if (kindFilter != null) {
    queryString = `kind(${JSON.stringify(kindFilter)}, ${queryString})`;
  }
  return query(rootPath, queryString);
}

/**
 * Reads the configuration file for the Buck project and returns the requested property.
 *
 * @param section Section in the configuration file.
 * @param property Configuration option within the section.
 *
 * @return Promise that resolves to the value, if it is set, else `null`.
 */
export async function getBuckConfig(
  rootPath: NuclideUri,
  section: string,
  property: string,
): Promise<?string> {
  const buckConfig = await _loadBuckConfig(rootPath);
  if (!buckConfig.hasOwnProperty(section)) {
    return null;
  }
  const sectionConfig = buckConfig[section];
  if (!sectionConfig.hasOwnProperty(property)) {
    return null;
  }
  return sectionConfig[property];
}

/**
 * TODO(natthu): Also load .buckconfig.local. Consider loading .buckconfig from the home directory
 * and ~/.buckconfig.d/ directory.
 */
async function _loadBuckConfig(rootPath: string): Promise<BuckConfig> {
  const header = 'scope = global\n';
  const buckConfigContent = await fsPromise.readFile(
    nuclideUri.join(rootPath, '.buckconfig'),
    'utf8',
  );
  return ini.parse(header + buckConfigContent);
}

/**
 * Runs `buck build --keep-going --build-report <tempfile>` with the specified targets. Regardless
 * whether the build is successful, this returns the parsed version of the JSON report
 * produced by the {@code --build-report} option:
 * http://facebook.github.io/buck/command/build.html.
 *
 * An error should be thrown only if the specified targets are invalid.
 * @return Promise that resolves to a build report.
 */
export function build(
  rootPath: NuclideUri,
  buildTargets: Array<string>,
  options?: BaseBuckBuildOptions,
): Promise<any> {
  return _build(rootPath, buildTargets, options || {});
}

/**
 * Runs `buck install --keep-going --build-report <tempfile>` with the specified targets.
 *
 * @param run If set to 'true', appends the buck invocation with '--run' to run the
 *   installed application.
 * @param debug If set to 'true', appends the buck invocation with '--wait-for-debugger'
 *   telling the launched application to stop at the loader breakpoint
 *   waiting for debugger to connect
 * @param simulator The UDID of the simulator to install the binary on.
 * @return Promise that resolves to a build report.
 */
export function install(
  rootPath: NuclideUri,
  buildTargets: Array<string>,
  simulator: ?string,
  run: boolean,
  debug: boolean,
): Promise<any> {
  return _build(rootPath, buildTargets, {install: true, simulator, run, debug});
}

async function _build(
  rootPath: NuclideUri,
  buildTargets: Array<string>,
  options: BaseBuckBuildOptions,
): Promise<any> {
  const report = await fsPromise.tempfile({suffix: '.json'});
  const args = _translateOptionsToBuckBuildArgs({
    baseOptions: {...options},
    pathToBuildReport: report,
    buildTargets,
  });

  try {
    await _runBuckCommandFromProjectRoot(
      rootPath,
      args,
      options.commandOptions,
      false, // Do not add the client ID, since we already do it in the build args.
      true, // Build commands are blocking.
    );
  } catch (e) {
    // The build failed. However, because --keep-going was specified, the
    // build report should have still been written unless any of the target
    // args were invalid. We check the contents of the report file to be sure.
    const stat = await fsPromise.stat(report).catch(() => null);
    if (stat == null || stat.size === 0) {
      throw e;
    }
  }

  try {
    const json: string = await fsPromise.readFile(report, {encoding: 'UTF-8'});
    try {
      return JSON.parse(json);
    } catch (e) {
      throw Error(`Failed to parse:\n${json}`);
    }
  } finally {
    fsPromise.unlink(report);
  }
}

/**
 * Same as `build`, but returns additional output via an Observable.
 * @return An Observable with the following implementations:
 *   onNext: Calls the Observer with successive strings from stdout and stderr.
 *     Each update will be of the form: {stdout: string;} | {stderr: string;}
 *     TODO: Use a union to exactly match `{stdout: string;} | {stderr: string;}` when the service
 *     framework supports it. Use an object with optional keys to mimic the union.
 *   onError: If the build fails, calls the Observer with the string output
 *     from stderr.
 *   onCompleted: Only called if the build completes successfully.
 */
export function buildWithOutput(
  rootPath: NuclideUri,
  buildTargets: Array<string>,
  extraArguments: Array<string>,
): ConnectableObservable<ProcessMessage> {
  return _buildWithOutput(rootPath, buildTargets, {extraArguments}).publish();
}

/**
 * Same as `build`, but returns additional output via an Observable.
 * @return An Observable with the following implementations:
 *   onNext: Calls the Observer with successive strings from stdout and stderr.
 *     Each update will be of the form: {stdout: string;} | {stderr: string;}
 *     TODO: Use a union to exactly match `{stdout: string;} | {stderr: string;}` when the service
 *     framework supports it. Use an object with optional keys to mimic the union.
 *   onError: If the build fails, calls the Observer with the string output
 *     from stderr.
 *   onCompleted: Only called if the build completes successfully.
 */
export function testWithOutput(
  rootPath: NuclideUri,
  buildTargets: Array<string>,
  extraArguments: Array<string>,
  debug: boolean,
): ConnectableObservable<ProcessMessage> {
  return _buildWithOutput(rootPath, buildTargets, {
    test: true,
    extraArguments,
    debug,
  }).publish();
}

/**
 * Same as `install`, but returns additional output via an Observable.
 * @return An Observable with the following implementations:
 *   onNext: Calls the Observer with successive strings from stdout and stderr.
 *     Each update will be of the form: {stdout: string;} | {stderr: string;}
 *     TODO: Use a union to exactly match `{stdout: string;} | {stderr: string;}` when the service
 *     framework supports it. Use an object with optional keys to mimic the union.
 *   onError: If the install fails, calls the Observer with the string output
 *     from stderr.
 *   onCompleted: Only called if the install completes successfully.
 */
export function installWithOutput(
  rootPath: NuclideUri,
  buildTargets: Array<string>,
  extraArguments: Array<string>,
  simulator: ?string,
  run: boolean,
  debug: boolean,
): ConnectableObservable<ProcessMessage> {
  return _buildWithOutput(rootPath, buildTargets, {
    install: true,
    simulator,
    run,
    debug,
    extraArguments,
  }).publish();
}

export function runWithOutput(
  rootPath: NuclideUri,
  buildTargets: Array<string>,
  extraArguments: Array<string>,
  simulator: ?string,
): ConnectableObservable<ProcessMessage> {
  return _buildWithOutput(rootPath, buildTargets, {
    run: true,
    simulator,
    extraArguments,
  }).publish();
}

/**
 * Does a build/install.
 * @return An Observable that returns output from buck, as described by the
 *   docblocks for `buildWithOutput` and `installWithOutput`.
 */
function _buildWithOutput(
  rootPath: NuclideUri,
  buildTargets: Array<string>,
  options: BaseBuckBuildOptions,
): Observable<ProcessMessage> {
  const args = _translateOptionsToBuckBuildArgs({
    baseOptions: {...options},
    buildTargets,
  });
  return Observable.fromPromise(
    _getBuckCommandAndOptions(rootPath),
  ).switchMap(({pathToBuck, buckCommandOptions}) =>
    observeProcess(pathToBuck, args, {...buckCommandOptions})
      .startWith({
        kind: 'stdout',
        data: `Starting "${pathToBuck} ${_getArgsStringSkipClientId(args)}"`,
      }));
}

function _getArgsStringSkipClientId(args: Array<string>): string {
  const skipped = args.findIndex(arg => arg === 'client.id=nuclide');
  return args
    .filter((arg, index) => index !== skipped && index !== skipped - 1)
    .join(' ');
}

/**
 * @param options An object describing the desired buck build operation.
 * @return An array of strings that can be passed as `args` to spawn a
 *   process to run the `buck` command.
 */
function _translateOptionsToBuckBuildArgs(
  options: FullBuckBuildOptions,
): Array<string> {
  const {
    baseOptions,
    pathToBuildReport,
    buildTargets,
  } = options;
  const {
    install: doInstall,
    run,
    simulator,
    test,
    debug,
    extraArguments,
  } = baseOptions;

  let args = [test ? 'test' : doInstall ? 'install' : run ? 'run' : 'build'];
  args = args.concat(buildTargets, CLIENT_ID_ARGS);

  if (!run) {
    args.push('--keep-going');
  }
  if (pathToBuildReport) {
    args = args.concat(['--build-report', pathToBuildReport]);
  }
  if (doInstall) {
    if (simulator) {
      args.push('--udid');
      args.push(simulator);
    }

    if (run) {
      args.push('--run');
      if (debug) {
        args.push('--wait-for-debugger');
      }
    }
  } else if (test) {
    if (debug) {
      args.push('--debug');
    }
  }
  if (extraArguments != null) {
    args = args.concat(extraArguments);
  }
  return args;
}

export async function listAliases(
  rootPath: NuclideUri,
): Promise<Array<string>> {
  const args = ['audit', 'alias', '--list'];
  const result = await _runBuckCommandFromProjectRoot(rootPath, args);
  const stdout = result.stdout.trim();
  return stdout ? stdout.split('\n') : [];
}

export async function listFlavors(
  rootPath: NuclideUri,
  targets: Array<string>,
): Promise<?Object> {
  const args = ['audit', 'flavors', '--json'].concat(targets);
  try {
    const result = await _runBuckCommandFromProjectRoot(rootPath, args);
    return JSON.parse(result.stdout);
  } catch (e) {
    return null;
  }
}

/**
 * Currently, if `aliasOrTarget` contains a flavor, this will fail.
 */
export async function resolveAlias(
  rootPath: NuclideUri,
  aliasOrTarget: string,
): Promise<string> {
  const args = ['query', aliasOrTarget];
  const result = await _runBuckCommandFromProjectRoot(rootPath, args);
  return result.stdout.trim();
}

/**
 * Returns the build output metadata for the given target.
 * This will contain one element if the target is unique; otherwise it will
 * contain data for all the targets (e.g. for //path/to/targets:)
 *
 * The build output path is typically contained in the 'buck.outputPath' key.
 */
export async function showOutput(
  rootPath: NuclideUri,
  aliasOrTarget: string,
  extraArguments: Array<string> = [],
): Promise<Array<Object>> {
  const args = ['targets', '--json', '--show-output', aliasOrTarget].concat(
    extraArguments,
  );
  const result = await _runBuckCommandFromProjectRoot(rootPath, args);
  return JSON.parse(result.stdout.trim());
}

export async function buildRuleTypeFor(
  rootPath: NuclideUri,
  aliasesOrTargets: string,
): Promise<ResolvedRuleType> {
  const resolvedRuleTypes = await Promise.all(
    aliasesOrTargets
      .trim()
      .split(/\s+/)
      .map(target => _buildRuleTypeFor(rootPath, target)),
  );

  if (resolvedRuleTypes.length === 1) {
    return resolvedRuleTypes[0];
  } else {
    return {
      buildTarget: {
        qualifiedName: aliasesOrTargets,
        flavors: [],
      },
      type: MULTIPLE_TARGET_RULE_TYPE,
    };
  }
}

export async function _buildRuleTypeFor(
  rootPath: NuclideUri,
  aliasOrTarget: string,
): Promise<ResolvedRuleType> {
  let flavors;
  if (aliasOrTarget.includes('#')) {
    const nameComponents = aliasOrTarget.split('#');
    flavors = nameComponents.length === 2 ? nameComponents[1].split(',') : [];
  } else {
    flavors = [];
  }

  const canonicalName = _normalizeNameForBuckQuery(aliasOrTarget);
  const args = [
    'query',
    canonicalName,
    '--json',
    '--output-attributes',
    'buck.type',
  ];
  const result = await _runBuckCommandFromProjectRoot(rootPath, args);
  const json: {[target: string]: Object} = JSON.parse(result.stdout);
  // If aliasOrTarget is an alias, targets[0] will be the fully qualified build target.
  const targets = Object.keys(json);
  if (targets.length === 0) {
    throw new Error(`Error determining rule type of '${aliasOrTarget}'.`);
  }
  let qualifiedName;
  let type;
  // target: and target/... build a set of targets.
  // These don't have a single rule type so let's just return something.
  if (targets.length > 1) {
    qualifiedName = canonicalName;
    type = MULTIPLE_TARGET_RULE_TYPE;
  } else {
    qualifiedName = targets[0];
    type = json[qualifiedName]['buck.type'];
  }
  return {
    buildTarget: {
      qualifiedName,
      flavors,
    },
    type,
  };
}

// Buck query doesn't allow omitting // or adding # for flavors, this needs to be fixed in buck.
function _normalizeNameForBuckQuery(aliasOrTarget: string): string {
  let canonicalName = aliasOrTarget;
  // Don't prepend // for aliases (aliases will not have colons or .)
  if (
    (canonicalName.indexOf(':') !== -1 || canonicalName.indexOf('.') !== -1) &&
    !canonicalName.startsWith('//')
  ) {
    canonicalName = '//' + canonicalName;
  }
  // Strip flavor string
  const flavorIndex = canonicalName.indexOf('#');
  if (flavorIndex !== -1) {
    canonicalName = canonicalName.substr(0, flavorIndex);
  }
  return canonicalName;
}

const _cachedPorts = new Map();

export async function getHTTPServerPort(rootPath: NuclideUri): Promise<number> {
  let port = _cachedPorts.get(rootPath);
  if (port != null) {
    if (port === -1) {
      return port;
    }
    // If there are other builds on the promise queue, wait them out.
    // This ensures that we don't return the port for another build.
    await getPool(rootPath, false).submit(() => Promise.resolve());
    const msg = await getWebSocketStream(rootPath, port)
      .refCount()
      .take(1)
      .toPromise()
      .catch(() => null);
    if (msg != null && msg.type === 'SocketConnected') {
      return port;
    }
  }

  const args = ['server', 'status', '--json', '--http-port'];
  const result = await _runBuckCommandFromProjectRoot(rootPath, args);
  const json: Object = JSON.parse(result.stdout);
  port = json['http.port'];
  _cachedPorts.set(rootPath, port);
  return port;
}

/** Runs `buck query --json` with the specified query. */
export async function query(
  rootPath: NuclideUri,
  queryString: string,
): Promise<Array<string>> {
  const args = ['query', '--json', queryString];
  const result = await _runBuckCommandFromProjectRoot(rootPath, args);
  const json: Array<string> = JSON.parse(result.stdout);
  return json;
}

/**
 * Runs `buck query --json` with a query that contains placeholders and therefore expects
 * arguments.
 * @param query Should contain '%s' placeholders.
 * @param args Should be a list of build targets or aliases. The query will be run for each arg.
 *   It will be substituted for '%s' when it is run.
 * @return object where each arg in args will be a key. Its corresponding value will be the list
 *   of matching build targets in its results.
 */
export async function queryWithArgs(
  rootPath: NuclideUri,
  queryString: string,
  args: Array<string>,
): Promise<{[aliasOrTarget: string]: Array<string>}> {
  const completeArgs = ['query', '--json', queryString].concat(args);
  const result = await _runBuckCommandFromProjectRoot(rootPath, completeArgs);
  const json: {[aliasOrTarget: string]: Array<string>} = JSON.parse(
    result.stdout,
  );

  // `buck query` does not include entries in the JSON for params that did not match anything. We
  // massage the output to ensure that every argument has an entry in the output.
  for (const arg of args) {
    if (!json.hasOwnProperty(arg)) {
      json[arg] = [];
    }
  }
  return json;
}

// TODO: Nuclide's RPC framework won't allow BuckWebSocketMessage here unless we cover
// all possible message types. For now, we'll manually typecast at the callsite.
export function getWebSocketStream(
  rootPath: NuclideUri,
  httpPort: number,
): ConnectableObservable<Object> {
  return createBuckWebSocket(httpPort).publish();
}

const LOG_PATH = 'buck-out/log/buck-0.log';
const LOG_REGEX = /\[([^\]]+)]/g;

function stripBrackets(str: string): string {
  return str.substring(1, str.length - 1);
}

export async function getLastCommandInfo(
  rootPath: NuclideUri,
  maxArgs?: number,
): Promise<?CommandInfo> {
  const logFile = nuclideUri.join(rootPath, LOG_PATH);
  if (await fsPromise.exists(logFile)) {
    const result = await asyncExecute('head', ['-n', '1', logFile]);
    if (result.exitCode === 0) {
      const line = result.stdout;
      const matches = line.match(LOG_REGEX);
      if (matches == null || matches.length < 2) {
        return null;
      }
      // Log lines are of the form:
      // [time][level][?][?][JavaClass] .... [args]
      // Parse this to figure out what the last command was.
      const timestamp = Number(new Date(stripBrackets(matches[0])));
      if (isNaN(timestamp)) {
        return null;
      }
      const args = stripBrackets(matches[matches.length - 1]).split(', ');
      if (args.length <= 1 || (maxArgs != null && args.length - 1 > maxArgs)) {
        return null;
      }
      return {timestamp, command: args[0], args: args.slice(1)};
    }
  }
  return null;
}
