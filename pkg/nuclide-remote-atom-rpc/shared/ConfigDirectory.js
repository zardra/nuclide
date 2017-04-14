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

import {arrayCompact} from '../../commons-node/collection';
import fs from '../../commons-node/fsPromise';
import nuclideUri from '../../commons-node/nuclideUri';
import {getLogger} from '../../nuclide-logging';
import {asyncFind} from '../../commons-node/promise';
import os from 'os';

const logger = getLogger();

export const RPC_PROTOCOL = 'atom_rpc_protocol';

const NUCLIDE_DIR = '.nuclide';
const NUCLIDE_SERVER_INFO_DIR = 'command-server';
const SERVER_INFO_FILE = 'serverInfo.json';

export type ServerInfo = {
  // Port for local command scripts to connect to the nuclide-server.
  commandPort: number,
  // address family
  family: string,
};

/**
 * The local command server stores its state in files in a directory. The structure of the config
 * directory is as follows:
 * - It contains a list of subdirectories where the name of each subdirectory corresponds to the
 *   port of the nuclide-server whose data it contains.
 * - Each subdirectory contains a serverInfo.json file, which contains a ServerInfo about the
 *   instance of nuclide-server.
 *
 * Code in this file is used by the NuclideServer process as well as the atom
 * command line process on the server.
 */
async function createConfigDirectory(clearDirectory: boolean): Promise<?NuclideUri> {
  const configDirPath = await findPathToConfigDirectory(clearDirectory);
  if (configDirPath != null) {
    return configDirPath;
  } else {
    return null;
  }
}

export async function createNewEntry(
  commandPort: number,
  family: string,
): Promise<void> {
  const clearDirectory = true;
  const configDirectory = await createConfigDirectory(clearDirectory);
  if (configDirectory == null) {
    throw new Error('Could\'t create config directory');
  }

  // TODO: Instead of using this dummy '0' port, will need to figure out
  // a directory structure which can handle multiple registered servers on the client side.
  const subdir = nuclideUri.join(configDirectory, String(0));
  await fs.rmdir(subdir);
  if (await fs.exists(subdir)) {
    throw new Error('createNewEntry: Failed to delete: ' + subdir);
  }
  const info = {
    commandPort,
    family,
  };
  await fs.mkdir(subdir);
  await fs.writeFile(nuclideUri.join(subdir, SERVER_INFO_FILE), JSON.stringify(info));

  logger.debug(
    `Created new remote atom config at ${subdir} for port ${commandPort} family ${family}`);
}

export async function getServer(): Promise<?ServerInfo> {
  const clearDirectory = false;
  const configDirectory = await createConfigDirectory(clearDirectory);
  if (configDirectory == null) {
    throw new Error('Could\'t create config directory');
  }

  const serverInfos = await getServerInfos(configDirectory);
  // For now, just return the first ServerInfo found.
  // Currently there can be only one ServerInfo at a time.
  // In the future, we may use the serverMetadata to determine which server
  // to use.
  if (serverInfos.length > 0) {
    const {commandPort, family} = serverInfos[0];
    logger.debug(
      `Read remote atom config at ${configDirectory} for port ${commandPort} family ${family}`);
    return serverInfos[0];
  } else {
    return null;
  }
}

async function getServerInfos(configDirectory: NuclideUri): Promise<Array<ServerInfo>> {
  const entries = await fs.readdir(configDirectory);
  return arrayCompact(await Promise.all(entries.map(async entry => {
    const subdir = nuclideUri.join(configDirectory, entry);
    const info = JSON.parse(await fs.readFile(nuclideUri.join(subdir, SERVER_INFO_FILE), 'utf8'));
    if (info.commandPort != null && info.family != null) {
      return info;
    } else {
      return null;
    }
  })));
}

function findPathToConfigDirectory(clearDirectory: boolean): Promise<?string> {
  // Try some candidate directories. We exclude the directory if it is on NFS
  // because nuclide-server is local, so it should only write out its state to
  // a local directory.

  const {homedir} = os.userInfo();

  const candidateDirectories: Array<?string> = [
    // Try the ~/local directory (if it exists) to avoid directly polluting homedirs.
    nuclideUri.resolve(nuclideUri.join(homedir, 'local')),
    // Then try the OS temporary directory...
    os.tmpdir(),
    // And fall back to the home directory as a last resort.
    homedir,
  ];

  return asyncFind(
    candidateDirectories,
    async directory => {
      if (directory != null && await fs.isNonNfsDirectory(directory)) {
        const configDirPath = nuclideUri.join(directory, NUCLIDE_DIR, NUCLIDE_SERVER_INFO_DIR);
        if (clearDirectory) {
          // When starting up a new server, we remove any connection configs leftover
          // from previous runs.
          await fs.rmdir(configDirPath);
          if (await fs.exists(configDirPath)) {
            throw new Error('findPathToConfigDirectory: Failed to remove' + configDirPath);
          }
        }
        await fs.mkdirp(configDirPath);
        return configDirPath;
      } else {
        return null;
      }
    });
}
