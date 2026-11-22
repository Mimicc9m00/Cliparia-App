# Cliparia

O Cliparia encontra destaques em lives e replays públicos do YouTube, da Twitch e da Kick. Ele gera cortes, salva os vídeos no Google Drive e organiza a revisão e a publicação em uma fila.

## Recursos

- **Estúdio** para processar uma fonte e ajustar os cortes antes de publicar.
- **Contínuo** para acompanhar canais ao vivo, avançar pelos trechos de replays e evitar cortes repetidos.
- **Edição** com enquadramento vertical, legendas opcionais e sugestões de título, descrição e hashtags.
- **Fila de postagem** para revisar o conteúdo, escolher os destinos e programar envios para contas autorizadas. No modo de envio à caixa de entrada do TikTok, a publicação é concluída no celular.

## Rodar no Windows

Instale Node.js 22 ou superior, FFmpeg com FFprobe e suporte ao filtro Whisper, e yt-dlp. Após baixar ou clonar este repositório, abra um terminal na raiz e execute:

```powershell
cd Cliparia
node app.mjs
```

Abra o [Cliparia local](http://127.0.0.1:43871). Em **Contas**, conecte o Google Drive e use **Instalar legendas locais** para baixar o modelo de transcrição. Conecte também as plataformas que for usar para publicação. [Guia de instalação e uso no Windows](Cliparia/LEIA-ME.md)

## Rodar na nuvem

O Cliparia pode rodar em um servidor Linux com Docker Compose ou em lotes pelo GitHub Actions. No modo por lotes, o estado fica em um arquivo criptografado no Drive e o painel pode ser hospedado no Cloudflare. A configuração usa suas próprias contas e credenciais. [Guia de servidor e GitHub Actions](Cliparia/SERVIDOR.md)

## Testes

Na pasta `Cliparia`, execute `node --test tests/*.test.mjs`.
