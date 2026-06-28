FROM node:20
WORKDIR /app
COPY . .
[span_8](start_span)RUN npm install
EXPOSE 7860
ENV PORT=7860
CMD ["npm", "start"]
