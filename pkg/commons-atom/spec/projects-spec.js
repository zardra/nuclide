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
import temp from 'temp';
import nuclideUri from '../../commons-node/nuclideUri';
import {
  getFileForPath,
  observeProjectPaths,
  onDidAddProjectPath,
  onDidRemoveProjectPath,
} from '../projects';

describe('projects', () => {
  let firstProjectPath: string = (null: any);
  let otherProjectPath: string = (null: any);

  beforeEach(() => {
    temp.track();
    // `atom.project.addPath` only works for paths that actually exist.
    firstProjectPath = temp.mkdirSync('firstProjectPath');
    otherProjectPath = temp.mkdirSync('otherProjectPath');
  });

  describe('getFileForPath', () => {
    it('works for paths both above and below the project path', () => {
      atom.project.setPaths([firstProjectPath]);
      const path1 = nuclideUri.join(firstProjectPath, '../test');
      const file1 = getFileForPath(path1);
      invariant(file1 != null);
      expect(file1.getPath()).toBe(path1);

      const path2 = nuclideUri.join(firstProjectPath, 'child/path');
      const file2 = getFileForPath(path2);
      invariant(file2 != null);
      expect(file2.getPath()).toBe(path2);
    });
  });

  describe('observeProjectPaths()', () => {
    it('observes existing projects and future added projects', () => {
      const projectPaths: Array<string> = [];
      atom.project.setPaths([firstProjectPath]);
      observeProjectPaths(projectPath => { projectPaths.push(projectPath); });
      expect(projectPaths).toEqual([firstProjectPath]);
      atom.project.addPath(otherProjectPath);
      expect(projectPaths).toEqual([firstProjectPath, otherProjectPath]);
    });
  });

  describe('onDidAddProjectPath()', () => {
    it('listens only to newly added project paths', () => {
      const addedProjectPaths: Array<string> = [];
      atom.project.setPaths([firstProjectPath]);
      onDidAddProjectPath(projectPath => { addedProjectPaths.push(projectPath); });
      expect(addedProjectPaths.length).toBe(0);
      atom.project.addPath(otherProjectPath);
      expect(addedProjectPaths).toEqual([otherProjectPath]);
    });

    it('throws when doing updates within updates', () => {
      expect(() => {
        onDidAddProjectPath(projectPath => {
          atom.project.addPath(otherProjectPath);
        });
        atom.project.setPaths([firstProjectPath]);
      }).toThrow('Cannot update projects in the middle of an update');
      expect(() => {
        onDidAddProjectPath(projectPath => {
          atom.project.removePath(firstProjectPath);
        });
        atom.project.setPaths([firstProjectPath]);
      }).toThrow('Cannot update projects in the middle of an update');
    });
  });

  describe('onDidRemoveProjectPath()', () => {
    it('listens to removed project paths', () => {
      const removedProjectPaths: Array<string> = [];
      atom.project.setPaths([firstProjectPath]);
      onDidRemoveProjectPath(projectPath => { removedProjectPaths.push(projectPath); });
      expect(removedProjectPaths.length).toBe(0);
      atom.project.removePath(firstProjectPath);
      expect(removedProjectPaths).toEqual([firstProjectPath]);
    });

    it('throws when doing updates within updates', () => {
      expect(() => {
        onDidRemoveProjectPath(projectPath => {
          atom.project.addPath(otherProjectPath);
        });
        atom.project.setPaths([firstProjectPath]);
      }).toThrow('Cannot update projects in the middle of an update');
      expect(() => {
        onDidRemoveProjectPath(projectPath => {
          atom.project.removePath(firstProjectPath);
        });
        atom.project.setPaths([firstProjectPath]);
      }).toThrow('Cannot update projects in the middle of an update');
    });
  });
});
