/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 */

export type AndroidJavaProcess = {
  user: string,
  pid: string,
  name: string,
};


export type DebugBridgeType = 'adb' | 'sdb';

export type DeviceDescription = {
  name: string,
  architecture: string,
  apiVersion: string,
  model: string,
};
