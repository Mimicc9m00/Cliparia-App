# Cliparia em um servidor Linux

O servidor executa a clipagem e a fila contínua. Depois que ele estiver configurado, você poderá fechar a aba ou desligar seu PC. O servidor mantém o histórico, a fila, o registro contra repetições e as credenciais em um volume persistente.

## Hospedagem gratuita

Na Oracle Cloud Free Tier, procure uma instância **VM.Standard.A1.Flex** marcada como **Always Free Eligible**, com **2 OCPUs, 12 GB de RAM**, Ubuntu 24.04 ARM64 e o disco de inicialização padrão. Use a região principal da sua conta. A disponibilidade depende da região e a Oracle pode recolher instâncias gratuitas ociosas. Confira o rótulo de gratuidade de cada recurso no console antes de criar. [Recursos Always Free da Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

O site precisa de um endereço com HTTPS. Você pode usar um domínio que já tem ou um subdomínio gratuito como `meu-cliparia.duckdns.org`. Aponte o endereço para o IPv4 público do servidor. Libere TCP 80 e 443 nas regras de rede da Oracle e no firewall do sistema. Restrinja o SSH (22) ao seu IP quando possível. [Duck DNS](https://www.duckdns.org/)

## Instalação

1. Instale o Docker Engine e o plugin Compose no servidor. Transfira a pasta do projeto ou extraia o pacote `Cliparia-servidor.tar.gz` em uma pasta própria. [Instalar Docker no Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
2. Na pasta, gere uma chave com `openssl rand -hex 32`. Escolha uma senha para acessar o site e gere o hash com `sudo docker run --rm -it caddy:2 caddy hash-password`. Crie o `.env` com os campos abaixo e limite o acesso a ele com `chmod 600 .env`. Guarde uma cópia segura da chave. Ela protege o cofre e é necessária para recuperar as conexões se você mudar de servidor.

```dotenv
CLIPARIA_DOMAIN=meu-cliparia.duckdns.org
CLIPARIA_USER=cliparia
CLIPARIA_PASSWORD_HASH='cole-o-hash-do-caddy'
CLIPARIA_VAULT_KEY=cole-os-64-caracteres-hexadecimais
```

3. Rode `sudo docker compose build`, restaure os dados do PC se quiser preservar a fila e, depois, rode `sudo docker compose up -d --wait`. A primeira compilação prepara o FFmpeg com Whisper e pode demorar. O Caddy fornece HTTPS e pede a senha do site. Confira o serviço com `sudo docker compose ps` e, se necessário, `sudo docker compose logs --tail=60 cliparia https`.
4. Abra o endereço HTTPS. Em **Contas**, reconecte o Google Drive com a mesma conta que guarda os clipes antigos. Para Drive e YouTube, crie um cliente OAuth **Aplicativo da Web** com o endereço exato do servidor como URI de redirecionamento, incluindo a barra final. Se o projeto Google estiver em **Teste**, as autorizações usadas pelo Cliparia expiram em sete dias. Confira o modo **Em produção** para uso contínuo. [Redirecionamento OAuth do Google](https://developers.google.com/identity/protocols/oauth2/web-server) · [Expiração das autorizações](https://developers.google.com/identity/protocols/oauth2#expiration)
5. Reconecte os demais destinos desejados. Use **Instalar legendas locais** uma vez para instalar o modelo Whisper. Teste uma fonte curta, confirme que o clipe aparece no Drive e confira os destinos antes de ativar o modo contínuo. No APK, informe o endereço HTTPS e as credenciais do site.

O Compose reinicia os serviços após reinicializações do servidor. Guarde backups do volume **cliparia_data** e da chave do cofre. Os limites de publicação e autorizações das plataformas continuam valendo no servidor. Em uma instância de dois núcleos, comece com uma fonte simultânea e verifique quanto tempo a análise leva antes de aumentar a fila.

## Transferir a fila e o histórico do Windows

1. Pause **Contínuo** no PC, aguarde as clipagens e os envios em andamento e feche o Cliparia. Deixe a instância do PC parada durante a mudança para evitar envios concorrentes.
2. Em `%LOCALAPPDATA%\Cliparia` (ou na pasta configurada em `CLIPARIA_DATA`), copie `lives.json`, `continuo.json`, `publicacoes.json` e `cortes-gerados.json`, quando disponível, para uma pasta `migracao` no servidor, ao lado de `compose.yaml`. Esses arquivos preservam o histórico, a posição das fontes e os registros de cortes e publicações. O `contas.dat` do Windows usa o cofre do Windows. Reconecte as contas na aba **Contas** do servidor. Os clipes no Drive continuam na mesma conta. Se você tem clipes antigos que ficaram apenas no disco local, guarde as pastas correspondentes no PC.
3. Antes da primeira inicialização do servidor, com a imagem já compilada, importe os arquivos para o volume:

```sh
sudo docker compose run --rm --no-deps --user root -v "$PWD/migracao:/migracao:ro" cliparia sh -ec '
  for file in lives.json continuo.json publicacoes.json cortes-gerados.json; do
    [ ! -e "/data/$file" ] || { echo "Já existe /data/$file. A importação foi cancelada."; exit 1; }
  done
  for file in lives.json continuo.json publicacoes.json cortes-gerados.json; do
    [ -f "/migracao/$file" ] || continue
    node --input-type=module -e "import fs from \"node:fs\"; JSON.parse(fs.readFileSync(process.argv[1], \"utf8\"))" "/migracao/$file"
  done
  for file in lives.json continuo.json publicacoes.json cortes-gerados.json; do
    [ -f "/migracao/$file" ] || continue
    install -m 600 -o node -g node "/migracao/$file" "/data/$file"
  done
'
```

4. Inicie o servidor, reconecte as contas e confira o histórico e o estado de **Contínuo**. Confira também a **Fila de postagem**, que guarda a seleção, a ordem e as configurações automáticas vinculadas às contas autorizadas.

## Acionamento pelo GitHub Actions

Os workflows **Verificar fontes do Contínuo** e **Processar fila de postagem** solicitam um ciclo ao servidor existente. Cada um tem agendamento periódico e execução manual em **Actions → Run workflow**. O servidor faz o trabalho e aplica a pausa, os limites de captura, o intervalo de postagem e as autorizações existentes. Uma resposta HTTP 202 confirma que o servidor recebeu o acionamento.

1. Gere um token exclusivo com `openssl rand -hex 32`, coloque-o como `CLIPARIA_AUTOMATION_TOKEN` no `.env` do servidor e aplique a configuração com `docker compose up -d`. Guarde o token fora do repositório.
2. No GitHub, em **Settings → Secrets and variables → Actions**, crie a variável `CLIPARIA_URL` com a origem HTTPS do servidor. Em **Secrets**, salve o mesmo token com o nome `CLIPARIA_AUTOMATION_TOKEN`.
3. Coloque os arquivos de `.github/workflows` na branch padrão do repositório. Acione cada workflow manualmente para conferir a conexão.

O token permite apenas acionar esses dois ciclos. O acesso à interface, às contas e aos dados continua protegido pela senha do site. O Cliparia precisa estar rodando no endereço HTTPS para atender os workflows, e o GitHub pode atrasar acionamentos agendados. [Regras do agendamento](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Lote independente pelo GitHub Actions

**Cliparia · Executar lote na nuvem** funciona com o PC desligado. Cada execução verifica uma fonte do Contínuo, captura um bloco curto de live ou avança um trecho de VOD, e processa a fila automática já autorizada. A ordem, os registros contra repetições, os recibos e as credenciais ficam em um arquivo criptografado no Drive. Os cortes continuam na pasta habitual do Drive. O cron faz verificações periódicas e pode atrasar. Uma live pode ter partes fora da janela capturada.

1. No Cliparia local, confira as fontes e os destinos da fila. Pause a clipagem e os envios, espere as tarefas em andamento terminarem e feche o servidor. A revisão de cortes e a configuração de contas são feitas antes da transferência. O lote não mantém a interface web aberta.
2. Coloque o código e `.github/workflows` no repositório e rode **Cliparia · Preparar imagem para nuvem**. Copie a referência `ghcr.io/...@sha256:...` do resumo para a variável `CLIPARIA_CLOUD_IMAGE` no GitHub.
3. Na pasta do projeto, rode `node cloud-prepare.mjs --continuous --posting` para transferir a base e ligar os dois modos no lote. Passe só `--continuous` ou `--posting` se quiser apenas um deles. A preparação bloqueia a abertura da base antiga no PC para evitar duplicidade.
4. Abra o arquivo local `cloud-secrets.json` no caminho exibido e adicione seus três valores separadamente em **Settings → Secrets and variables → Actions → Secrets**. Guarde esse arquivo fora do repositório. Em **Variables**, defina `CLIPARIA_CLOUD_ENABLED` como `true`. Rode **Cliparia · Executar lote na nuvem** manualmente para conferir a primeira execução.

O lote usa as permissões das contas já cadastradas. No TikTok, a caixa de entrada ainda exige finalizar pelo celular. O envio alternativo do Instagram por link HTTPS depende de um endereço alcançável, disponível na instalação com servidor. Se um lote for interrompido, o próximo fica bloqueado para revisão, pois a plataforma pode ter recebido um envio antes de o estado ser salvo. O lote e o servidor local usam bases separadas depois da transferência, sem sincronização de edições pela interface.
