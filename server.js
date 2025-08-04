
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

// Se quiser servir arquivos estáticos como index.html, coloque em 'public/'
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.send("Servidor Quizcelência está rodando! ✅");
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let salas = {};

function gerarRanking(pontuacoes, jogadores) {
  return jogadores.map(j => ({
    nome: j.nome,
    pontos: pontuacoes[j.id] || 0
  })).sort((a, b) => b.pontos - a.pontos);
}

io.on("connection", (socket) => {
  console.log("Conectado:", socket.id);

  socket.on("entrarSala", ({ sala, nome }) => {
    socket.join(sala);
    if (!salas[sala]) {
      salas[sala] = {
        jogadores: [],
        respostas: {},
        pontuacoes: {},
        votosReset: new Set(),
        jogoFinalizado: false
      };
    }

    const salaAtual = salas[sala];
    if (salaAtual.jogadores.length >= 10) {
      socket.emit("erro", "Sala cheia");
      return;
    }

    salaAtual.jogadores.push({ id: socket.id, nome });
    salaAtual.pontuacoes[socket.id] = 0;
    io.to(sala).emit("jogadoresAtualizados", salaAtual.jogadores);
  });

  socket.on("responder", ({ sala, acertou }) => {
    const salaAtual = salas[sala];
    if (!salaAtual || salaAtual.jogoFinalizado) return;

    salaAtual.respostas[socket.id] = acertou;
    if (acertou) {
      salaAtual.pontuacoes[socket.id] += 1;
    }

    if (Object.keys(salaAtual.respostas).length === salaAtual.jogadores.length) {
      const resultado = salaAtual.jogadores.map(j => ({
        nome: j.nome,
        acertou: !!salaAtual.respostas[j.id]
      }));

      io.to(sala).emit("resultadoRodada", resultado);

      const vencedor = Object.entries(salaAtual.pontuacoes).find(([_, p]) => p >= 30);
      if (vencedor) {
        salaAtual.jogoFinalizado = true;
        const ranking = gerarRanking(salaAtual.pontuacoes, salaAtual.jogadores);
        io.to(sala).emit("fimDeJogo", ranking);
      } else {
        setTimeout(() => {
          salaAtual.respostas = {};
          io.to(sala).emit("novaRodada");
        }, 5000);
      }
    }
  });

  socket.on("solicitarReset", (sala) => {
    const salaAtual = salas[sala];
    if (!salaAtual) return;
    salaAtual.votosReset.add(socket.id);
    if (salaAtual.votosReset.size === salaAtual.jogadores.length) {
      salaAtual.respostas = {};
      salaAtual.pontuacoes = {};
      salaAtual.votosReset.clear();
      salaAtual.jogoFinalizado = false;
      salaAtual.jogadores.forEach(j => {
        salaAtual.pontuacoes[j.id] = 0;
      });
      io.to(sala).emit("jogoResetado");
    } else {
      io.to(sala).emit("votoResetAtualizado", salaAtual.votosReset.size);
    }
  });

  socket.on("disconnect", () => {
    for (let salaId in salas) {
      let sala = salas[salaId];
      sala.jogadores = sala.jogadores.filter(j => j.id !== socket.id);
      delete sala.pontuacoes[socket.id];
      delete sala.respostas[socket.id];
      sala.votosReset.delete(socket.id);
      io.to(salaId).emit("jogadoresAtualizados", sala.jogadores);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
