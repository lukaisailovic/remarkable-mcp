FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="remarkable-mcp" \
      org.opencontainers.image.description="SSH-only MCP server for a reMarkable tablet, with Cloudflare Code Mode." \
      org.opencontainers.image.source="https://github.com/lukaisailovic/remarkable-mcp" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
# Pin pnpm to match packageManager in package.json.
RUN corepack enable && corepack prepare pnpm@11.13.0 --activate
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
