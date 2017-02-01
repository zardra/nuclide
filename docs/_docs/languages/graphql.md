---
pageid: language-graphql
title: GraphQL
layout: docs
permalink: /docs/languages/graphql/
---

Nuclide has built-in support for [GraphQL](http://graphql.org/).

* TOC
{:toc}

## Installing GraphQL

Several [server libraries](http://graphql.org/code/) are provided for GraphQL implementation in a wide range of languages.

Opening a `.graphql` file in Nuclide will trigger the GraphQL support.

## Features

GraphQL's integration into Nuclide provides you with productivity features such as:

- [Autocomplete](#features__autocomplete)
- [Go to Definition](#features__go-to-definition)
- [Outline View](#features__outline-view)
- [Context View](#features__context-view)
- [Code Diagnostics](#features__code-diagnostics)

### Autocomplete

![](/static/images/docs/language-graphql-autocomplete.png)

### Go to Definition

Nuclide provides a **Go to Definition** feature for GraphQL files.

For example, if you want to go to the definition of `pilotFragment`, hover over `...pilotFragment` and either press **Cmd-<click>** or **Cmd-Option-Enter**.  You can also right-click on the fragment and select **Go to Declaration** from the pop-up menu.

![](/static/images/docs/language-graphql-gotodefinition.png)

The cursor will jump to the definition even if it's in another file.

![](/static/images/docs/language-graphql-definitionjump.png)

### Outline View

### Context View

### Code Diagnostics

Nuclide has code diagnostics that will show errors in your `.graphql` file.  You can see the errors in two places, inline within the [Editing Area](/docs/editor/basics/#editing-area) and in the [Code Diagnostics](/docs/editor/basics/#status-bar__code-diagnostics) pane below.

![](/static/images/docs/language-graphql-diagnosticspane.png)

Hover over the sideways red triangle in the [gutter](/docs/editor/basics/#gutter) to see the error inline.

![](/static/images/docs/language-graphql-inline-error.png)
