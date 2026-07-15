FROM node:22-alpine AS build
WORKDIR /app
ARG API_URL=http://backend:3000
ENV API_URL=$API_URL
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/src/i18n ./src/i18n
EXPOSE 5173
CMD ["npm", "run", "start"]
