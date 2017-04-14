/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

import type {StatusCodeNumberValue} from '../../nuclide-hg-rpc/lib/HgService';
import type {HgRepositoryClient} from '../../nuclide-hg-repository-client/lib/HgRepositoryClient';
import type {IconName} from '../../nuclide-ui/types';
import type {NuclideUri} from '../../commons-node/nuclideUri';

import {arrayCompact, mapFilter} from '../../commons-node/collection';
import {asyncExecute} from '../../commons-node/process';
import {diffSets} from '../../commons-node/observable';
import {Directory} from 'atom';
import {getFileSystemServiceByNuclideUri} from '../../nuclide-remote-connection';
import {hgConstants} from '../../nuclide-hg-rpc';
import invariant from 'assert';
import nuclideUri from '../../commons-node/nuclideUri';
import {Observable} from 'rxjs';
import {observableFromSubscribeFunction} from '../../commons-node/event';
import {track} from '../../nuclide-analytics';

type VcsInfo = {
  vcs: string,
  root: string,
};

const {StatusCodeNumber: HgStatusCodeNumber} = hgConstants;
const vcsInfoCache: {[dir: string]: VcsInfo} = {};

async function findVcsHelper(dir: string): Promise<VcsInfo> {
  const options = {cwd: dir};
  const hgResult = await asyncExecute('hg', ['root'], options);
  if (hgResult.exitCode === 0) {
    return {
      vcs: 'hg',
      root: hgResult.stdout.trim(),
    };
  }

  const gitResult = await asyncExecute('git', ['rev-parse', '--show-toplevel'], options);
  if (gitResult.exitCode === 0) {
    return {
      vcs: 'git',
      root: gitResult.stdout.trim(),
    };
  }

  throw new Error('Could not find VCS for: ' + dir);
}

/**
 * For the given source file, find the type of vcs that is managing it as well
 * as the root directory for the VCS.
 */
export async function findVcs(dir: string): Promise<VcsInfo> {
  let vcsInfo = vcsInfoCache[dir];
  if (vcsInfo) {
    return vcsInfo;
  }

  vcsInfo = await findVcsHelper(dir);
  vcsInfoCache[dir] = vcsInfo;
  return vcsInfo;
}

export type FileChangeStatusValue = 1 | 2 | 3 | 4 | 5;

export const FileChangeStatus = Object.freeze({
  ADDED: 1,
  MODIFIED: 2,
  MISSING: 3,
  REMOVED: 4,
  UNTRACKED: 5,
});

(FileChangeStatus: {[key: string]: FileChangeStatusValue});

export const HgStatusToFileChangeStatus
  : {[key: StatusCodeNumberValue]: FileChangeStatusValue} = Object.freeze({
    [HgStatusCodeNumber.ADDED]: FileChangeStatus.ADDED,
    [HgStatusCodeNumber.MODIFIED]: FileChangeStatus.MODIFIED,
    [HgStatusCodeNumber.MISSING]: FileChangeStatus.MISSING,
    [HgStatusCodeNumber.REMOVED]: FileChangeStatus.REMOVED,
    [HgStatusCodeNumber.UNTRACKED]: FileChangeStatus.UNTRACKED,
  },
);

export const FileChangeStatusToPrefix: {[key: FileChangeStatusValue]: string} = Object.freeze({
  [FileChangeStatus.ADDED]: '[A] ',
  [FileChangeStatus.MODIFIED]: '[M] ',
  [FileChangeStatus.MISSING]: '[!] ',
  [FileChangeStatus.REMOVED]: '[D] ',
  [FileChangeStatus.UNTRACKED]: '[?] ',
});

export const FileChangeStatusToIcon: {[key: ?FileChangeStatusValue]: IconName} = Object.freeze({
  [FileChangeStatus.ADDED]: 'diff-added',
  [FileChangeStatus.MODIFIED]: 'diff-modified',
  [FileChangeStatus.MISSING]: 'stop',
  [FileChangeStatus.REMOVED]: 'diff-removed',
  [FileChangeStatus.UNTRACKED]: 'question',
});

export const FileChangeStatusToTextColor: {[key: ?FileChangeStatusValue]: string} = Object.freeze({
  [FileChangeStatus.ADDED]: 'text-success',
  [FileChangeStatus.MODIFIED]: 'text-warning',
  [FileChangeStatus.MISSING]: 'text-error',
  [FileChangeStatus.REMOVED]: 'text-error',
  [FileChangeStatus.UNTRACKED]: 'text-error',
});

export const RevertibleStatusCodes = [
  FileChangeStatus.ADDED,
  FileChangeStatus.MODIFIED,
  FileChangeStatus.REMOVED,
];

export const DIFF_EDITOR_MARKER_CLASS = 'nuclide-diff-editor-marker';

export function getDirtyFileChanges(
  repository: HgRepositoryClient,
): Map<NuclideUri, FileChangeStatusValue> {
  const dirtyFileChanges = new Map();
  const statuses = repository.getAllPathStatuses();
  for (const filePath in statuses) {
    const changeStatus = HgStatusToFileChangeStatus[statuses[filePath]];
    if (changeStatus != null) {
      dirtyFileChanges.set(filePath, changeStatus);
    }
  }
  return dirtyFileChanges;
}

const UPDATE_STATUS_DEBOUNCE_MS = 50;
export function observeStatusChanges(
  repository: HgRepositoryClient,
): Observable<Map<NuclideUri, FileChangeStatusValue>> {
  return observableFromSubscribeFunction(
    repository.onDidChangeStatuses.bind(repository),
  )
  .debounceTime(UPDATE_STATUS_DEBOUNCE_MS)
  .startWith(null)
  .map(() => getDirtyFileChanges(repository));
}

export function addPath(nodePath: ?NuclideUri): Promise<void> {
  return hgActionToPath(
    nodePath,
    'add',
    'Added',
    async (hgRepository: HgRepositoryClient) => {
      invariant(nodePath);
      track('hg-repository-add', {nodePath});
      await hgRepository.addAll([nodePath]);
    },
  );
}

export function revertPath(nodePath: ?NuclideUri, toRevision?: ?string): Promise<void> {
  return hgActionToPath(
    nodePath,
    'revert',
    'Reverted',
    async (hgRepository: HgRepositoryClient) => {
      invariant(nodePath);
      track('hg-repository-revert', {nodePath});
      await hgRepository.revert([nodePath], toRevision);
    },
  );
}

export function confirmAndRevertPath(path: ?NuclideUri, toRevision?: ?string): void {
  const result = atom.confirm({
    message: 'Are you sure you want to revert?',
    buttons: ['Revert', 'Cancel'],
  });
  invariant(result === 0 || result === 1);
  if (result === 0) {
    revertPath(path, toRevision);
  }
}

async function hgActionToPath(
  nodePath: ?NuclideUri,
  actionName: string,
  actionDoneMessage: string,
  action: (hgRepository: HgRepositoryClient) => Promise<void>,
): Promise<void> {
  if (nodePath == null || nodePath.length === 0) {
    atom.notifications.addError(`Cannot ${actionName} an empty path!`);
    return;
  }
  const repository = repositoryForPath(nodePath);
  if (repository == null || repository.getType() !== 'hg') {
    atom.notifications.addError(`Cannot ${actionName} a non-mercurial repository path`);
    return;
  }
  const hgRepository: HgRepositoryClient = (repository: any);
  try {
    await action(hgRepository);
    atom.notifications.addSuccess(
      `${actionDoneMessage} \`${repository.relativize(nodePath)}\` successfully.`,
    );
  } catch (error) {
    atom.notifications.addError(
      `Failed to ${actionName} \`${repository.relativize(nodePath)}\``,
      {detail: error.message},
    );
  }
}

export function getHgRepositories(): Set<HgRepositoryClient> {
  return new Set(
    (arrayCompact(atom.project.getRepositories())
      // Flow doesn't understand that this filters to hg repositories only, so cast through `any`
      .filter(repository => repository.getType() === 'hg'): Array<any>),
  );
}

export function getHgRepositoryStream(): Observable<HgRepositoryClient> {
  const currentRepositories =
    observableFromSubscribeFunction(atom.project.onDidChangePaths.bind(atom.project))
    .startWith(null)
    .map(() => getHgRepositories());

  return diffSets(currentRepositories).flatMap(
    repoDiff => Observable.from(repoDiff.added),
  );
}

/**
 * @param aPath The NuclideUri of a file or directory for which you want to find
 *   a Repository it belongs to.
 * @return A Git or Hg repository the path belongs to, if any.
 */
export function repositoryForPath(aPath: NuclideUri): ?atom$Repository {
  // Calling atom.project.repositoryForDirectory gets the real path of the directory,
  // which requires a round-trip to the server for remote paths.
  // Instead, this function keeps filtering local.
  const repositories = arrayCompact(atom.project.getRepositories());
  return repositories.find(
    repo => {
      try {
        return repositoryContainsPath(repo, aPath);
      } catch (e) {
        // The repo type is not supported.
        return false;
      }
    },
  );
}

/**
 * @param repository Either a GitRepository or HgRepositoryClient.
 * @param filePath The absolute file path of interest.
 * @return boolean Whether the file path exists within the working directory
 *   (aka root directory) of the repository, or is the working directory.
 */
export function repositoryContainsPath(
  repository: atom$Repository,
  filePath: NuclideUri,
): boolean {
  const workingDirectoryPath = repository.getWorkingDirectory();
  if (pathsAreEqual(workingDirectoryPath, filePath)) {
    return true;
  }

  if (repository.getType() === 'git') {
    const rootGitProjectDirectory = new Directory(workingDirectoryPath);
    return rootGitProjectDirectory.contains(filePath);
  } else if (repository.getType() === 'hg') {
    const hgRepository = ((repository: any): HgRepositoryClient);
    return hgRepository._workingDirectory.contains(filePath);
  }
  throw new Error(
    'repositoryContainsPath: Received an unrecognized repository type. Expected git or hg.');
}

/**
 * @param filePath1 An abolute file path.
 * @param filePath2 An absolute file path.
 * @return Whether the file paths are equal, accounting for trailing slashes.
 */
function pathsAreEqual(filePath1: string, filePath2: string): boolean {
  const realPath1 = nuclideUri.resolve(filePath1);
  const realPath2 = nuclideUri.resolve(filePath2);
  return realPath1 === realPath2;
}

export function filterMultiRootFileChanges(
  unfilteredFileChanges: Map<NuclideUri, Map<NuclideUri, FileChangeStatusValue>>,
): Map<NuclideUri, Map<NuclideUri, FileChangeStatusValue>> {
  const filteredFileChanges = new Map();
  // Filtering the changes to make sure they only show up under the directory the
  // file exists under.
  for (const [root, fileChanges] of unfilteredFileChanges) {
    const filteredFiles = mapFilter(
      fileChanges,
      filePath => filePath.startsWith(root),
    );
    filteredFileChanges.set(root, filteredFiles);
  }

  return filteredFileChanges;
}

export function getMultiRootFileChanges(
  fileChanges: Map<NuclideUri, FileChangeStatusValue>,
  rootPaths?: Array<NuclideUri>,
): Map<NuclideUri, Map<NuclideUri, FileChangeStatusValue>> {
  let roots;
  if (rootPaths == null) {
    roots = arrayCompact(
      atom.project.getDirectories().map(directory => {
        const rootPath = directory.getPath();
        const repository = repositoryForPath(rootPath);
        if ((repository == null || repository.getType() !== 'hg')) {
          return null;
        }
        return nuclideUri.ensureTrailingSeparator(rootPath);
      }),
    );
  } else {
    roots = rootPaths.map(root => nuclideUri.ensureTrailingSeparator(root));
  }

  const sortedFilePaths = Array.from(fileChanges.entries())
    .sort(([filePath1], [filePath2]) =>
      nuclideUri.basename(filePath1).toLowerCase().localeCompare(
        nuclideUri.basename(filePath2).toLowerCase(),
      ),
    );

  const changedRoots = new Map(roots.map(root => {
    const rootChanges = new Map(
      sortedFilePaths.filter(([filePath]) => nuclideUri.contains(root, filePath)),
    );
    return [root, rootChanges];
  }));

  return changedRoots;
}

export async function confirmAndDeletePath(nuclideFilePath: NuclideUri): Promise<boolean> {
  const result = atom.confirm({
    message: 'Are you sure you want to delete the following item?',
    detailedMessage: `You are deleting: \n ${nuclideUri.getPath(nuclideFilePath)}`,
    buttons: ['Delete', 'Cancel'],
  });
  invariant(result === 0 || result === 1);
  if (result === 0) {
    return deleteFile(nuclideFilePath);
  }
  return false;
}

async function deleteFile(nuclideFilePath: string): Promise<boolean> {
  const filePath = nuclideUri.getPath(nuclideFilePath);
  const fsService = getFileSystemServiceByNuclideUri(nuclideFilePath);
  try {
    await fsService.unlink(filePath);
    const repository = repositoryForPath(nuclideFilePath);
    if (repository == null || repository.getType() !== 'hg') {
      return false;
    }
    await ((repository: any): HgRepositoryClient).remove([filePath], true);
  } catch (error) {
    atom.notifications.addError('Failed to delete file', {
      detail: error,
    });
    return false;
  }
  return true;
}
