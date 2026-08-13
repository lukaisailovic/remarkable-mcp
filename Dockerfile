FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json rolldown.config.js ./
COPY src ./src
RUN pnpm build && pnpm prune --prod
ENV MCP_HTTP=1
ENV MCP_HTTP_HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
