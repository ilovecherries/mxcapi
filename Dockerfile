FROM node:lts-slim
RUN apt update && apt install -y tini
ENTRYPOINT ["tini", "node", "."]

COPY --chown=node:node . /appservice
WORKDIR /appservice

USER node

RUN npm i --no-audit --no-fund
CMD [""]
