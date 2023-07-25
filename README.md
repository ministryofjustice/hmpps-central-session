# hmpps-central-session

[![repo standards badge](https://img.shields.io/badge/dynamic/json?color=blue&style=flat&logo=github&label=MoJ%20Compliant&query=%24.result&url=https%3A%2F%2Foperations-engineering-reports.cloud-platform.service.justice.gov.uk%2Fapi%2Fv1%2Fcompliant_public_repositories%2Fhmpps-central-session)](https://operations-engineering-reports.cloud-platform.service.justice.gov.uk/public-github-repositories.html#hmpps-central-session 'Link to report')
[![CircleCI](https://circleci.com/gh/ministryofjustice/hmpps-central-session/tree/main.svg?style=svg)](https://circleci.com/gh/ministryofjustice/hmpps-central-session)
![NPM Downloads](https://img.shields.io/npm/dw/@ministryofjustice/hmpps-central-session)

A library for implementing a shared central user session between microservice frontends

## Contents

1. [Building](readme/building.md)
2. [Testing](readme/testing.md)
3. [Maintenance](readme/maintenance.md)
4. [Architecture Decision Records](architecture-decision-record/README.md)
5. [Publishing to NPM](readme/publishing.md)

## Overview

The HMPPS Central Session is used as a wrapper for `express-session` in order to easily allow node applications to use the new [Central Session API](https://github.com/ministryofjustice/hmpps-central-session-api/) so that they may use [micro-frontend components](https://github.com/ministryofjustice/hmpps-micro-frontend-components/) with the correct user information.

### Background

> Something about HMPPS Auth, tokens, etc

### How it works

```mermaid
flowchart LR
    A[Service]
    B[Service session]
    C[("Service specific
    Redis")]
    D(Central Session API)
    E[("Central Session
    Redis")]
    A-- "Get/Set Session" --> B
    B-- "Sevice specific
    session information" -->C
    B-- "User passport" -->D
    D --> E
```

We split the session up into two separate parts:

- The global session
  - This currently contains the session information that is needed to be accessed across applications
  - Currently this is the users login passport
- The local session
  - This contains all other data for the session that is relevant to just the service

The global session is then sent over to the Central Session API, and the local session saved to the service specific Redis instance.

## Installation

This can be installed from NPM by using

```bash
npm i --save @ministryofjustice/hmpps-central-session
```

## Importing

```ts
import { hmppsSessionBuilder } from '@ministryofjustice/hmpps-central-session'
```

## Usage

### Config options

| Option                     | Description                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `cookie`                   | The [cookie options](https://github.com/expressjs/session#cookie) to pass to express-session\* |
| `sessionSecret`            | The secret (or secrets) for signing & verifying the session cookie                             |
| `sharedSessionApi.baseUrl` | The base URL for the central sessions API                                                      |
| `sharedSessionApi.token`   | The authentication token for the central session API                                           |
| `sharedSessionAip.timeout` | The timeout for central session API requests                                                   |

### Logging

You can optionally pass in a logger to the third argument of the session builder in order to see the log for the API Rest Client

### Implementation

To use the HMPPS Session you must first import the builder and initialise it

```ts
import { createRedisClient } from '../redisClient' // This is from the HMMPS Typescript template
import { hmppsSessionBuilder } from '@ministryofjustice/hmpps-central-session'
const redisClient = createRedisClient()
redisClient.connect().catch((err: Error) => logger.error(`Error connecting to Redis`, err))
const options = {
  cookie: { secure: true, maxAge: 120 * 60 * 60 },
  sessionSecret: 'SOME_SECRET_VALUE',
  sharedSesionApi: {
    baseUrl: 'API_URL',
    token: 'SOME_TOKEN',
  },
}

const sessionBuilder = hmppsSessionBuilder(redisClient, options)
```

Once you have this you can use it as middleware for your node application

#### For services

Services have the same service name for every request, this means we can use a single HMPPS Central Session instance for each request

```ts
const router = express.Router()
router.use(sessionBuilder('application-name'))
```

#### For components

Components act slightly differently, they will need to take the name of the service calling them from the request and contruct a new instance of HMPPS Session for each request. For example:

```ts
const router = express.Router()
router.use((req, res, next) =>
  sessionBuilder(req.query.sessionServiceName?.toString() || 'undefined-session-name')(req, res, next),
)
```

#### For End to End Tests

**Pre-requisites**

These instructions are based on the following assumptions:

- You use Cypress for running end-to-end tests
- You use Wiremock for mocking API calls during these tests
- Your setup has remained similar to the HMPPS Typescript Template

Examples below will use examples from the HMPPS Typescripe Template as a starting point

**Pointing to the API**

You will need to set the environment variable for the Sessions API to point to wiremock similar to how the Auth API is setup - this is usually in `feature.env` and can be set to:

```
SESSION_API_URL=http://localhost:9091/session
```

**Stubbing the API**

The sessions API will replace the authentication `/oauth/token` [see here](https://github.com/ministryofjustice/hmpps-template-typescript/blob/main/integration_tests/mockApis/auth.ts#L111) route as the source of the users token that gets populated in the session once the user is logged in. Alongside this, the sessions API will need to stub both support the `POST` (for session creation) and `DELETE` (session destruction).

This can be done via wiremock with the following:

```ts
import { stubFor } from './wiremock'

export default {
  getSession: (token: string) =>
    stubFor({
      request: {
        method: 'GET',
        urlPattern: '/session/sessions/(\\S*)/(\\S*)',
      },
      response: {
        status: 200,
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
        },
        jsonBody: {
          passport: {
            user: {
              token,
              username: 'USER1',
              authSource: 'nomis',
            },
          },
        },
      },
    }),
  postSession: () =>
    stubFor({
      request: {
        method: 'POST',
        urlPattern: '/session/sessions/(\\S*)/(\\S*)',
      },
      response: {
        status: 200,
        jsonBody: {},
      },
    }),
  deleteSession: () =>
    stubFor({
      request: {
        method: 'DELETE',
        urlPattern: '/session/sessions/(\\S*)/(\\S*)',
      },
      response: {
        status: 200,
        jsonBody: {},
      },
    }),
}
```

This allows you to pass in the token you want to be returned and populated for the user when you call it.

**Setting up the stubs**

Once the methods have been setup, the easiest way to integrate it with your existing tests is to extend the `stubSignIn` task that's created in the [HMPPS Typescript Template auth mock API](https://github.com/ministryofjustice/hmpps-template-typescript/blob/main/integration_tests/mockApis/auth.ts#L159-L160). This means you don't need to call any additional tasks elsewhere.

This can be done by importing the above example and doing:

```ts
// Update the token method to take the users token
const token = (userToken: string) =>
  stubFor({
    // Other fields omitted
    response: {
      // Other fields omitted
      jsonBody: {
        access_token: userToken,
        // Other fields omitted
      },
    },
  })

export default {
  // existing methods ommited
  stubSignIn: (): Promise<Response[]> => {
    const userToken = createToken()
    return Promise.all([
      favicon(),
      redirect(),
      signOut(),
      manageDetails(),
      token(userToken), // Passing in the user token
      tokenVerification.stubVerifyToken(),
      session.getSession(userToken),
      session.postSession(),
      session.deleteSession(),
    ])
  },
}
```

Once this is done when you call `cy.task('stubSignIn')` it will now also set up the session store to populate the users session correctly.