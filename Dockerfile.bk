# 🐳 Dockerfile per HuggingFace Spaces
# Clona direttamente da GitHub - non serve copiare file manualmente 

FROM node:20-slim

# Installa git e ffmpeg (per ffprobe necessario a IntroSkip)
RUN apt-get update && apt-get install -y git ffmpeg && rm -rf /var/lib/apt/lists/*

# Imposta la directory di lavoro
WORKDIR /app


ARG REPO_URL=https://github.com/qwertyuiop8899/icv_hf.git
ARG BRANCH=main

# Clona il repository
RUN git clone --depth 1 --branch ${BRANCH} ${REPO_URL} .

# Installa dipendenze di produzione + express
RUN npm install --omit=dev && npm install express

# Esponi la porta (HuggingFace usa 7860)
EXPOSE 7860

# Variabili d'ambiente di default (sovrascrivi in HF Secrets)
ENV PORT=7860
ENV NODE_ENV=production

# Avvia il server
CMD ["node", "server.js"]
