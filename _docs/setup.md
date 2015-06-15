---
id: setup
title: Setup
layout: docs
permalink: /docs/setup/
---

### Prerequisites 

The following versions are required before installing Nuclide:

+ Python 2.6 or later.
+ Atom 0.207.0 or later.
+ Node 0.12.0 or later.
+ `node`, `npm`, and `apm` must be on your `$PATH`.

The [Atom linter](https://atom.io/packages/linter) package is optional, but *strongly recommended*.

Of course, [Flow](/docs/flow/), [Hack](/docs/hack/), and [Mercurial](/docs/hg/) are 
also required if you wish to use their relevant Nuclide integrations - please read the guide for 
each package to see any additional requirements.

### Installing via NPM

The easiest way to get Nuclide is from NPM:

```bash
npm install nuclide
```

### Installing from Source

Building Nuclide is fairly straightforward, just run the following command from the root of the 
repository:

```bash
./scripts/dev/setup
```

or, if you're using Windows:

```bat
python scripts\dev\setup
```

This script will fetch the appropriate dependencies from npm and perform any necessary build steps. 

## Starting Nuclide

Once you've installed or built Nuclide, just run `Atom` - the initial load after the build process 
may be a little slow because of the large number of Babel files that need to be transpiled. 

## Installing Nuclide Server

If you want to use Nuclide for remote development, you'll also need to setup the `nuclide-server` 
package. Instructions can be found in the [Remote Development docs](docs/remote/).