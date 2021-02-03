FROM mhart/alpine-node:14 as builder

RUN apk add --no-cache make gcc g++ python git bash
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
WORKDIR /app
RUN git config --global url.https://github.com/.insteadOf ssh://git@github.com/
RUN npm ci
COPY . .
RUN npx webpack-cli --config ./webpack/webpack.docker.config.js

FROM mhart/alpine-node:14 as runtime

WORKDIR /app

COPY --from=builder "/app/node_modules/scrypt/build/Release" "./node_modules/scrypt/build/Release/"
COPY --from=builder "/app/node_modules/sha3/build/Release" "./node_modules/sha3/build/Release/"

ENV DOCKER true

EXPOSE 8545

ENTRYPOINT ["node", "/app/ganache-core.docker.cli.js"]