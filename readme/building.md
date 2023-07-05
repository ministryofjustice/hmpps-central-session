[< Back](../README.md)
---

## Building

To use the same version of NodeJS locally as is used in CI and production, follow [these notes](nvm.md).

First, build the project by running:

`npm install` and then `npm run build`

### Run linter

After making code changes eslint can be used to ensure code style is maintained
(although husky ensures this is run as part of the pre-commit hook too)
```
npm run lint
```

