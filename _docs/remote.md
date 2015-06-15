---
id: remote
title: Remote Development
layout: docs
permalink: /docs/remote/
---

![Nuclide connecting to a remote server](static/images/docs/NuclideRemote.gif)

Nuclide includes a `nuclide-server` package which creates the bridge between 
your local client version of Nuclide, and the development server that you want 
to work on. It has its own setup process that is outlined below. 

## Nuclide Server Setup

The following versions are required before installing the nuclide-server 
package:

+ Python 2.6 or later.
+ Node 0.12.0 or later.
+ `node`, and `npm` must be on your `$PATH`.
+ [Watchman](https://facebook.github.io/watchman). The Nuclide server
requires Watchman to detect file and directory changes. You can build and/or
install Watchman for your server's platform as described.
[here](http://facebook.github.io/watchman/docs/install.html#build-install).
+ SSH Daemon - The Nuclide client connects to the server via SSH, so
ensure that the server exposes an SSH daemon that you can connect to from your
client machine, and that you know the credentials required - you will need to
have an existing private key that can be used to connect to the server.

### Installing via NPM

The easiest way to get nuclide-server is from NPM:

```bash
npm install -g nuclide
```

We use the `-g` switch to ensure Nuclide is added to your server's `$PATH`, 
which will make connecting to it easier. 

You do not need to explicitly start the server since the Nuclide client will
attempt to do so when it first connects over SSH.

### Installing from Source

Building Nuclide Server is fairly straightforward, just run the following 
command from the root of the repository:

```bash
./scripts/dev/setup --no-atom
```

Note that the `--no-atom` flag ensures that only Nuclide's Node packages are
installed on the server, and not those used by the Atom client itself.

You should now also add to your `$PATH` the path of the 
pkg/nuclide/server/start-nuclide-server script to make connection simpler.

You do not need to explicitly start the server since the Nuclide client will
attempt to do so when it first connects over SSH.

## Connecting to your server from Nuclide

To connect to your server, go to the Packages menu in Atom and select the
'Connect...' option.

![Connect menu](static/images/docs/connect_menu.png)

You'll see the following dialog:

![Connect dialog](static/images/docs/connect.png)

Note that all of the values shown above are examples and will vary based on
your own username, filesystem, and SSH and Nuclide configuration. The options 
are as follows:

+ **Username** - the username that you would use to connect to your server
+ **Server** - the address of your server
+ **Initial Directory** - the path that you want to connect to initially on 
your server
+ **SSH Port** - the port used to connect to your server (default is 22)
+ **Private Key** - the local path to your private SSH key for this server
+ **Use ssh-agent-based authentication** - TODO: Describe
+ **Remote Server Command** - if you have correctly added the server script
to your path as described above, this should just be `start-nuclide-server`.
If not, you need to supply the full path to the location of this script. You 
can either let the script pick an open port for you from a list of predefined
ports, or start the server on a specific port using the `-p` flag.
For example `start-nuclide-server -p 9099`

After supplying these options, click OK to connect.

This connection will then initiate the Nuclide server on the remote machine if
it is not yet running. The result will be that the root folder you just
specified will appear in the left-hand tree view, underneath any local folders
you might have had open:

![Tree view](static/images/docs/tree_remote.png)

You can now use this tree to open and edit files as you would expect.