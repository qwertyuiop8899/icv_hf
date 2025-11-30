# 🐳 Dockerfile per HuggingFace Spaces
# Usa Node.js 20 LTS slim

FROM node:20-slim

# Imposta la directory di lavoro
WORKDIR /app

# Copia package files
COPY package*.json ./

# Installa solo le dipendenze di produzione + express
RUN npm install --omit=dev && npm install express

# Copia il resto del codice
COPY . .

# Esponi la porta (HuggingFace usa 7860)
EXPOSE 7860

# Variabili d'ambiente di default (sovrascrivi in HF Secrets)
ENV PORT=7860
ENV NODE_ENV=production

# Avvia il server
CMD ["node", "server.js"]
