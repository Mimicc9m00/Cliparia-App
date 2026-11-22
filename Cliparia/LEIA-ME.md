# Cliparia para Windows

Extraia o ZIP e abra a pasta **Cliparia**, onde está o arquivo **app.mjs**. No Explorador de Arquivos, clique com o botão direito em um espaço vazio da pasta e escolha **Abrir no Terminal**. Execute:

```text
node app.mjs
```

Deixe a janela do Terminal aberta durante o trabalho. Se o navegador não abrir, acesse http://127.0.0.1:43871.

O Cliparia precisa do Node.js 22 ou superior, FFmpeg (incluindo FFprobe) e yt-dlp. Se já instalou esses programas para uma versão anterior do Cliparia, pode reutilizá-los. Se algum comando não for encontrado, instale o componente correspondente pelo WinGet e abra uma nova janela do Terminal:

```text
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Gyan.FFmpeg --exact
winget install --id yt-dlp.yt-dlp --exact
```

Se o **Controle de Aplicativos Inteligentes** bloquear um desses programas, confira o nome do arquivo no Visualizador de Eventos, em **Logs de Aplicativos e Serviços → Microsoft → Windows → CodeIntegrity → Operational**. O evento 3077 pode identificar o arquivo.


## Gerar os cortes

1. Em **Contas**, conecte o Google Drive. Cole um link HTTPS de uma live pública ou VOD do YouTube, da Twitch ou da Kick. Para uma live da Kick, use o link do canal, como `https://kick.com/nome-do-canal`; no **Estúdio**, a transmissão precisa estar pública e ao vivo. Para um replay público, cole o link individual do vídeo. Use fontes que você tem direito de editar e publicar.
2. No **Auto-Layout inteligente · 9:16**, o Cliparia analisa vários quadros: webcam no canto vira painel superior com a gameplay embaixo; câmera cheia gera um recorte que acompanha o rosto; sem rosto ou webcam confirmada, o quadro inteiro fica centralizado sobre fundo desfocado. Com legendas ativas e fala reconhecida, um trecho curto aparece em destaque na divisão no início. Para lives com webcam pequena no canto superior direito, pouco abaixo da borda, selecione **Vertical · webcam no canto superior direito** para aplicar esse recorte direto em todos os clipes.
3. Escolha até quantos cortes gerar (5 a 20) e a duração inicial (40 a 180 segundos, padrão de 60). Se o VOD tiver poucos destaques, o app pode entregar uma quantidade menor. O Cliparia começa pelas mudanças na imagem, pelo áudio e pelos pontos mais revistos quando a fonte os oferece. Cada destaque recebe segundos de contexto antes e depois.
4. Para legendas, clique em **Instalar legendas locais**. O app baixa o modelo Whisper (148 MB) uma vez. O FFmpeg Full precisa incluir o filtro **whisper**. Se o app informar que o filtro está ausente, atualize com `winget upgrade --id Gyan.FFmpeg --exact` e reabra o Cliparia. As legendas são produzidas localmente para os clipes selecionados. O destaque de cada palavra acompanha a estimativa obtida pela divisão do tempo da frase.
5. O Cliparia analisa até 15 minutos por trecho. Se um trecho não render bons cortes ou a meta não for atingida, segue para o próximo. VODs têm prioridade na análise. Em lives, a análise acontece durante a captura em blocos de cerca de três minutos, que podem ser menores conforme o tamanho do fluxo.
6. Em **Revisar** no PC, ajuste o início e o fim dentro do corte gerado e use **Prévia do ajuste** antes de salvar. O corte editado mantém pelo menos 40 segundos. Salvar substitui o arquivo do corte no Drive.
7. Use **Selecionar para postagem** nos cortes que quiser enviar e escolha os destinos. Para revisar pelo celular, gere um link em **Celular** no PC e abra-o no navegador do telefone ou no APK. O link funciona na rede local ou pela internet, conforme o tipo de acesso escolhido.
8. **Criar título, descrição e hashtags automaticamente com as falas de cada clipe** vem ativado. Instale o modelo em **Instalar legendas locais**, mesmo se não quiser legendas na imagem. Cada corte recebe um título baseado em uma fala de destaque, uma descrição com as falas próximas e hashtags sobre o jogo e o assunto identificados. A geração é local, por seleção de falas e palavras-chave; sem fala reconhecida, usa os metadados da fonte. O nome no Drive também usa o título gerado. Ao ajustar o corte, os textos são recalculados com as falas restantes. No YouTube, título e descrição são preenchidos; no Instagram e TikTok, a legenda inclui as hashtags. Modelos de título preenchidos manualmente continuam tendo prioridade no envio automático. Na revisão, **Gerar título, legenda e hashtags** permite preencher novamente e editar antes do envio. Para publicar pelo Kwai ou finalizar um rascunho no TikTok, copie o texto na revisão e cole no aplicativo de destino.
   O jogo é identificado pelas falas e pelos metadados da transmissão. As hashtags priorizam o jogo, a franquia ou estúdio e o assunto do corte. Um corte sobre a estreia de GTA 6 usa **#gta6 #rockstar #lancamento #jogos** na legenda. Um corte sobre Tenebrae Lux usa **#tenebraelux** e pode incluir **#enigmas**. Quando falta contexto, o campo fica sem sugestão de hashtags. Os títulos incluem até três hashtags completas e respeitam 100 caracteres, inclusive no envio automático do YouTube. A seleção é contextual e local. Cortes que já estão na fila com geração de textos ativada recebem as novas tags a partir das falas salvas e do contexto conferido para aquele corte.

Na lista de cortes, use **Apagar do Drive** para mover um vídeo para a lixeira e preservar seu histórico. **Restaurar vídeo** torna o corte disponível de novo e pode retomar envios automáticos já autorizados. O Drive exclui definitivamente os itens que ficam 30 dias na lixeira. [Lixeira do Google Drive](https://developers.google.com/workspace/drive/api/guides/delete#trash)

**Evitar cortes repetidos no Estúdio e no Contínuo** vem ativado. Os dois modos consultam o mesmo registro de cortes gerados. Ao adicionar o link novamente, o Cliparia pula trechos identificados como repetidos e continua procurando outros destaques. Para replays, compara a transmissão e o intervalo original. Nas capturas ao vivo, compara também amostras da imagem, pois a posição da captura pode mudar. O registro é importado do histórico disponível e permanece salvo após reiniciar, limpar o histórico ou apagar um vídeo do Drive. Desmarque a opção se quiser gerar o mesmo trecho de propósito.

## Modo Contínuo

1. Abra a aba **Contínuo**, configure a fonte e clique em **Adicionar fonte**. Repita para outras lives ou VODs. As opções de duração, formato e legendas são salvas por fonte.
2. Clique em **Ativar modo contínuo**. O app começa com duas fontes simultâneas, com ajuste de uma a quatro. As demais aguardam na fila. O app analisa um bloco por vez e, entre as lives com blocos prontos, dá prioridade à que está há mais tempo sem análise.
3. Para acompanhar novas transmissões, marque **Acompanhar novas lives deste canal** ao cadastrar o link do canal da Twitch ou da Kick, como `https://kick.com/nome-do-canal`, ou um link de canal do YouTube terminado em **/live**. O Cliparia verifica o canal enquanto o modo contínuo estiver ativo e aguarda as próximas lives quando ele estiver offline. Links individuais de VODs ou replays são concluídos após o processamento.
4. O modo contínuo gera todos os destaques identificados, **sem limite total de cortes**. VODs são analisados até o fim em trechos de até 15 minutos, com sobreposição nas bordas para avaliar cortes que atravessam a divisão. Um trecho sem destaques não encerra a busca: o app verifica os seguintes. A posição da análise fica salva para a retomada. Lives continuam sendo analisadas em blocos enquanto a transmissão estiver disponível, mesmo depois da quantidade que antes encerrava a captura. A seleção continua exigindo sinais de destaque e aprovação na proteção de conteúdo; isso não garante reconhecer todos os acontecimentos interessantes. Fontes encerradas pela antiga meta são reabertas uma vez para examinar o restante, preservando fontes paradas manualmente.
5. **Pausar modo contínuo** impede novos trabalhos e encerra as capturas por blocos depois de aproveitar o material restante. O trecho de VOD em processamento pode terminar antes da pausa. Os cortes ficam em **Cortes do modo contínuo**, separados do **Estúdio**, inclusive na revisão pelo celular. A fila e sua configuração são retomadas ao reabrir o Cliparia.
6. Em **Adicionar à fila de postagem**, marque **Adicionar automaticamente os novos cortes aprovados**, escolha os destinos e salve. O corte entra na fila depois da aprovação da verificação de imagens e falas e do envio ao Drive. Os destinos compatíveis com a duração do corte seguem as configurações de envio da fila. Para parar de adicionar novos cortes, desmarque a opção e salve.

## Fila de postagem

1. Em **Estúdio** ou **Contínuo**, clique em **Selecionar para postagem**, marque os destinos e escolha **Verificar e adicionar à fila**. O Cliparia verifica imagens, falas e textos antes de colocar cada corte na fila. Cortes bloqueados ou com análise incompleta ficam de fora. Use **Fila de postagem** para alterar destinos, retirar cortes ou clicar em **Embaralhar ordem**. A lista fica salva ao fechar o Cliparia.
2. Em **Fila de postagem → Configurar plataformas**, confirme as contas do YouTube, Instagram ou Facebook que receberão envios automáticos. Em seguida, clique em **Ativar postagem automática**. As autorizações antigas por tarefa ou fonte não ativam a nova fila.
3. O intervalo padrão é de 15 minutos por corte e vale para a fila inteira. Um mesmo corte pode seguir para vários destinos configurados no mesmo ciclo. **Salvar intervalo** aceita de 1 a 1440 minutos. **Reiniciar contagem** começa a espera de novo e **Zerar contagem** libera o próximo corte elegível. A postagem automática e a clipagem contínua têm controles de pausa independentes.

Use **Editar texto** em um corte selecionado para salvar título, legenda e hashtags para os próximos envios em todos os destinos daquele corte. **Usar texto automático** volta a usar as sugestões para esse corte. A fila mostra o próximo corte automático previsto, a situação de cada destino e filtros por texto, situação e plataforma. O editor e os filtros também estão disponíveis na revisão pelo celular.

Em **Contas → Backup do Cliparia**, baixe um JSON da fila, do histórico e do registro de cortes repetidos. A restauração mescla os dados com a instalação atual e pausa o automático se adicionar cortes pendentes. O backup contém metadados e referências ao Drive. Os vídeos dependem dos arquivos originais, e as contas são conectadas pelo próprio Cliparia.
4. O YouTube usa a postagem automática da fila. **Verificar YouTube** compara os cortes com os uploads do canal conectado e sinaliza possíveis repetições para revisão. Para enviar manualmente aos outros destinos, abra o corte em **Fila de postagem → Revisar e publicar**. O Cliparia exclui o arquivo do Drive após confirmar todos os destinos selecionados e mantém o registro na aba **Publicados**.
5. O registro de envios em **publicacoes.json** identifica o mesmo corte e destino após o reinício ou o recadastro da fonte. Um envio de resultado incerto permanece registrado para evitar duplicação. **Publicados → Verificar publicações** consulta envios pendentes.

## Limite de uploads do YouTube

O erro `uploadLimitExceeded` indica que a conta atingiu o limite de uploads imposto pelo YouTube. Se a plataforma recusar o envio antes da transferência, o Cliparia mantém o clipe como **Falhou** e preserva o arquivo no Drive. Use **Agendar nova tentativa no YouTube** para devolver o corte à postagem automática. O envio segue o intervalo geral da fila.

Confira os recursos avançados em **YouTube Studio → Configurações → Canal → Qualificação para recursos**, conforme a [documentação do YouTube](https://support.google.com/youtube/answer/9891124?hl=pt-BR). A disponibilidade e o limite da conta são definidos pelo YouTube.

## Proteção contra conteúdo sexual

A proteção fica ativa no Estúdio e no modo Contínuo. Antes de guardar um novo clipe no Drive, o app verifica as falas e o título e analisa um quadro por segundo do vídeo exportado com o modelo visual NudeNet 320n. Quadros e transcrições são processados localmente. O modelo visual acompanha esta versão; para a análise das falas, instale o modelo em **Instalar legendas locais**, mesmo com as legendas no vídeo desativadas.

Trechos com indícios de nudez explícita ou expressões sexuais explícitas não são enviados ao Drive nem publicados. A tarefa informa os trechos não liberados. A revisão mostra o resultado da verificação e oferece **Verificar conteúdo**. Clipes antigos ainda disponíveis são verificados antes de um novo envio, inclusive manual, ou do download para publicação no Kwai. Ajustar o início ou o fim invalida a análise anterior. Se o modelo, a transcrição ou a leitura do vídeo falhar, o envio permanece bloqueado até uma nova verificação bem-sucedida.

A análise por amostragem pode deixar passar cenas rápidas e gerar falsos positivos; o detector visual reconhece nudez e não todas as formas de conteúdo sexual. Uma aprovação significa que os sinais configurados não foram detectados nas amostras e nos textos analisados. Vídeos já publicados não são removidos por essa verificação. A origem, o hash e a licença do modelo estão em **vendor/vision/NUDENET-NOTICE.md**.

## Conectar as contas

O app não inclui credenciais de desenvolvedor. A geração requer uma conta do Drive conectada com espaço disponível. As opções de conectar ficam em **Contas**.

### Google Drive

No Google Cloud Console, habilite **Google Drive API** em um projeto e crie um cliente OAuth do tipo **Aplicativo para computador**. Em um projeto em testes, inclua o Gmail do seu Drive entre os usuários de teste. Em **Contas → Google Drive → Configurar**, informe Client ID e Client Secret. Clique em **Conectar conta** e selecione o Gmail do armazenamento. O YouTube tem seu próprio botão de login e mantém sua própria autorização, inclusive quando usa outro Gmail.

A pasta **Cliparia · Cortes** é criada no Drive escolhido. O app solicita o escopo drive.file para trabalhar com seus próprios arquivos. O processamento ocorre no PC ou no servidor. O Cliparia guarda os vídeos processados no Drive e usa arquivos temporários locais para a geração de clipes e legendas. Credenciais protegidas e histórico de publicação ficam no Windows. O Drive recebe os cortes prontos. A qualidade disponível depende da faixa que o provedor fornece ao extrator.

### YouTube

No Google Cloud Console, crie ou escolha um projeto e ative **YouTube Data API v3**. Em Google Auth Platform, configure a tela de consentimento e, se o projeto estiver em testes, adicione seu Gmail aos usuários de teste. Crie um cliente OAuth do tipo **Aplicativo para computador**. Copie o Client ID e o Client Secret em **Contas → YouTube → Configurar**. Clique em **Conectar conta** e escolha o canal no navegador. O app pede acesso para identificar o canal e enviar os vídeos. Os limites de cota e a disponibilidade de publicação dependem do projeto e do canal.

https://developers.google.com/youtube/data/guides/uploading_a_video

### TikTok

No TikTok for Developers, configure um aplicativo **Desktop** com Login Kit e Content Posting API, habilitando **Upload** com o escopo video.upload, **Direct Post** com video.publish, ou ambos. Escolha a opção correspondente no Cliparia ao conectar. Quem já autorizou Direct Post pode usar **Alterar permissões** para acrescentar o envio ao celular. Registre exatamente este endereço de retorno:

http://127.0.0.1:43871/oauth/callback

Em **Contas → TikTok → Configurar**, informe Client Key e Client Secret. Conecte o perfil e selecione TikTok como destino de um corte. Em **Fila de postagem → Revisar e publicar**, **TikTok · Publicação direta** abre as opções autorizadas pelo perfil e **Finalizar no TikTok** transfere o vídeo ao TikTok. O estado “TikTok informou o envio da notificação” vem da API. A publicação é confirmada depois que você abre a notificação na caixa de entrada, edita e publica no TikTok. Se ela estiver ausente, clique em **Não recebi a notificação** para registrar o relato e baixar o MP4 e a legenda. A API exige consentimento e restringe clientes sem auditoria à visibilidade privada, além de aplicar limites de uso. O TikTok exclui utilitários exclusivos de uso pessoal ou interno dos casos aceitos para auditoria de Direct Post. A aprovação pública depende do TikTok.

https://developers.tiktok.com/docs/en/content-sharing-guidelines
https://developers.tiktok.com/docs/en/login-kit-desktop

### Erro de aplicativo TikTok sem auditoria

`unaudited_client_can_only_post_to_private_accounts` é uma restrição do Direct Post de aplicativos ainda não auditados pelo TikTok. Para testar esse modo, o TikTok exige que a **conta esteja privada** e que você selecione **Somente eu (SELF_ONLY)** para o vídeo. Escolher Somente eu em uma conta pública não resolve essa exigência. O Cliparia explica o erro e mantém a escolha da visibilidade com você, sem mudar sua conta nem tentar publicar em outro modo automaticamente.

Como alternativa, habilite Upload na Content Posting API do seu aplicativo e a permissão **video.upload**. No Cliparia, use **Contas → TikTok → Alterar permissões → Finalizar no celular** ou **Usar os dois modos**, conforme as permissões aprovadas do seu aplicativo. Depois, em **Fila de postagem → Revisar e publicar → Finalizar no TikTok**, confirme a transferência e conclua a publicação pela notificação na caixa de entrada do TikTok. Essa modalidade também depende das permissões e dos limites da plataforma. Para remover as restrições do Direct Post, é necessária a auditoria do aplicativo pelo TikTok, conforme as [diretrizes oficiais](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

Para usar o intervalo da fila no envio ao celular, abra **Fila de postagem → Configurar plataformas → TikTok · Caixa de entrada** e ative o envio automático. Em **Destinos do corte**, marque **TikTok** e autorize o envio desse vídeo. Isso vale também para clipes já na fila e para os adicionados pelo modo Contínuo. Abra a notificação no TikTok para concluir a publicação.

## Arquivos e recuperação

Os metadados e as conexões ficam em %LOCALAPPDATA%\Cliparia. Os vídeos das versões anteriores continuam acessíveis no histórico. A regra de exclusão automática vale para novos cortes enviados a partir desta versão. Você pode fechar o app, extrair uma atualização em outra pasta e reabrir com a mesma conta Windows. O Cliparia restaura as conexões e renova a autorização quando o serviço permite. Permissões revogadas ou expiradas exigem novo login. As credenciais e tokens são protegidos com DPAPI da conta Windows. Desconectar remove os tokens locais. A permissão também pode ser revogada nas configurações da plataforma.

Se uma gravação pública deixar de baixar, atualize o extrator com `winget upgrade --id yt-dlp.yt-dlp --exact`. Gravações removidas, protegidas por login ou indisponíveis para o extrator podem falhar. Se o serviço perder a conexão durante um envio, confira o perfil antes de tentar outra vez.

## Correção de captura de lives (vídeo e áudio separados)

Nas versões anteriores, o Cliparia exigia um único formato HLS com vídeo **e** áudio, mesmo quando o YouTube ou a Twitch oferecia playlists separadas. A captura agora lê os formatos selecionados pelo yt-dlp e, quando necessário, utiliza duas entradas do FFmpeg para reunir vídeo e áudio sem salvar a live completa em disco. A seleção prioriza a qualidade de vídeo oferecida pela plataforma. As imagens da live são analisadas por blocos em memória. O app também aceita endereços HTTP(S) diretos quando oferecidos pelo extrator; conteúdo protegido ou sem faixa de áudio disponível continua indisponível.

Caso uma live falhe, primeiro confirme se ela está pública e em andamento e atualize o yt-dlp com `winget upgrade --id yt-dlp.yt-dlp --exact`. Os erros de FFmpeg agora evitam incluir endereços assinados ou tokens da transmissão; códigos HTTP (quando detectáveis) podem ser apresentados. A correção foi validada em teste local com playlists HLS de vídeo e áudio separadas. **Não constitui garantia de compatibilidade com todas as lives reais:** políticas de acesso e formatos dos provedores podem mudar.

Para verificar a lógica de seleção sem iniciar o aplicativo: `node --test tests\live.test.mjs`.

## Erro HTTP 403 na abertura da mídia

Se o FFmpeg receber 403 na prévia, na análise de um VOD ou ao iniciar a captura de uma live, o Cliparia busca um endereço atualizado para a mesma transmissão. Se necessário, tenta um formato público diferente, priorizando imagem e áudio juntos. Se a captura já começou e a conexão cair, o Cliparia preserva o material recebido e segue o fluxo de análise da gravação.

Se todas as tentativas retornarem acesso negado, confira se a live ou o VOD abre publicamente no navegador e atualize o extrator com `winget upgrade --id yt-dlp.yt-dlp --exact`. Feche e reabra o Cliparia antes de tentar novamente.

## Instagram Reels

1. Vincule a conta profissional do Instagram (Criador ou Empresa) a uma Página do Facebook que você administra.
2. Use um aplicativo no Meta for Developers com **Facebook Login for Business** e as permissões necessárias para publicar, incluindo **instagram_basic** e **instagram_content_publish**. Para listar as Páginas e obter o token correspondente, use **pages_show_list** e **pages_read_engagement** quando solicitado pela configuração do app.
3. Em **Contas → Instagram → Conectar** ou **Reconectar**, escolha **Gerar token de longa duração**. Informe o mesmo ID profissional do Instagram, um token de usuário recém-gerado no Explorador da Graph API, o ID e o segredo do mesmo app Meta. O Cliparia prolonga o token, encontra a Página vinculada, confirma que a autorização não tem vencimento fixo e salva apenas o token da Página no cofre. Se já obteve o token duradouro da Página na Meta, escolha **Usar token da Página já gerado**. A Meta ainda pode revogar o acesso, por exemplo, após mudanças nas permissões. Nesse caso, os envios do Instagram aguardam a reconexão. [Tokens de longa duração na Meta](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived)
4. Selecione o corte para postagem com **Instagram** como destino. Configure o Instagram na **Fila de postagem** para publicar automaticamente ou use **Revisar e publicar → Instagram** para confirmar o envio. A legenda padrão é opcional e aceita **{n}** para o número do corte.
5. O Cliparia converte o MP4 e transfere o vídeo diretamente para a Meta. O envio exige que o app da Meta tenha acesso ao upload resumível. A origem do arquivo no Drive pode permanecer privada. O Cliparia acompanha o processamento antes de publicar o Reel.

Se a conexão cair na validação da conta, o Cliparia repete a consulta e mantém o corte na fila caso a Meta continue indisponível. Se receber uma recusa de acesso ao usuário, o envio aguarda a regularização no Meta for Developers. Conclua eventuais confirmações de segurança da conta e use **Contas → Instagram → Verificar conexão** para testar o token salvo. Use **Reconectar** se a Meta informar que a autorização expirou.

Se a transferência falhar, o Cliparia consulta o contêiner na Meta. Quando a Meta recusa também a versão de compatibilidade, o app testa um link HTTPS temporário antes de entregá-lo à Meta e registra quanto do arquivo foi servido. O link dá acesso apenas à cópia daquele Reel e é fechado quando a Meta conclui o processamento ou após 15 minutos. Se a tentativa falhar, use **Fila de postagem → Revisar e publicar → Baixar para o Instagram**. Depois de publicar no aplicativo, cole o link em **Conferir e registrar publicação** para o Cliparia verificar o Reel no perfil conectado.

[Configuração e permissões do Instagram na documentação da Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

## Facebook Reels

1. No aplicativo da Meta, autorize **pages_manage_posts**, **pages_read_engagement** e **pages_show_list** para a Página. Gere um novo token depois de acrescentar as permissões. A autorização do Instagram sozinha não inclui publicar no Facebook.
2. Abra **Contas → Conectar Facebook**. Informe o **ID da Página**, que é diferente do ID profissional do Instagram, e um token de usuário ou da Página. O token é protegido no mesmo cofre das outras contas. Deixe o token vazio para tentar usar a autorização já salva do Instagram, desde que inclua as permissões do Facebook. Um token de usuário é convertido no token da Página selecionada.
3. Marque **Facebook** como destino ao selecionar um corte para postagem. Os Reels serão **públicos na Página**. O Cliparia aceita cortes de **40 a 90 segundos** nesse destino e prepara o vídeo vertical em 1080 × 1920, com título, legenda e hashtags baseados no clipe.
4. Na **Fila de postagem**, use **Revisar e publicar → Facebook** para confirmar cada publicação ou configure a Página para envio automático. O Facebook compartilha o intervalo e o registro de envios da fila.
5. O app transfere o arquivo diretamente para a Meta, solicita a publicação e acompanha a confirmação. Uma resposta incerta não dispara uma segunda publicação. O arquivo só é removido do Drive depois da confirmação em todos os destinos marcados. A proteção de conteúdo também se aplica ao Facebook.
6. Se a autorização expirar, obtenha um novo token da mesma Página e use **Contas → Facebook → Reconectar**. Os envios automáticos para o Facebook voltam a processar a fila. Para tentar de novo um corte marcado como **Falhou**, use **Fila de postagem → Revisar e publicar → Facebook**.

A API publica em **Páginas**, sem postagem em perfis pessoais. A Meta informa um limite de **30 Reels publicados pela API em uma janela de 24 horas**; o intervalo de 15 minutos não elimina esse limite. Não foi feita publicação real durante os testes de desenvolvimento.

[Publicação de Reels e permissões na documentação da Meta](https://developers.facebook.com/documentation/video-api/guides/reels-publishing).

## Kwai Brasil

Marque **Kwai · manual** como destino ao selecionar o corte. Em **Fila de postagem → Revisar e publicar → Publicar no Kwai**, baixe o MP4 no PC ou celular e publique no aplicativo do Kwai. Copie o link da postagem, cole no Cliparia e confirme.

[Instruções do Kwai para publicar vídeos](https://www.kwai.com/support/video/how-do-i-post-a-video).

## Diagnóstico de autenticação TikTok (versão revisada)

O Cliparia utiliza PKCE S256 com SHA-256 hexadecimal no fluxo TikTok Desktop, valida o verificador e envia a troca de token como application/x-www-form-urlencoded. A API pode rejeitar credenciais, códigos expirados, permissões ou configurações mesmo quando a requisição está correta. Se a mensagem de erro incluir `TikTok log_id`, forneça apenas esse identificador e a descrição do erro, **nunca** a URL completa do callback (que contém um código de uso único), Client Secret ou tokens.

A URL exata usada durante a autorização e a troca do token é `http://127.0.0.1:43871/oauth/callback`; ela deve corresponder ao registro de Desktop no TikTok Developers. O curinga na porta é opcional no cadastro, mas não deve ser usado como URL enviada pelo Cliparia.

## Acesso pelo celular

- Em **Celular → Pela internet · HTTPS**, clique em **Gerar link para o celular**. O Cliparia usa o `cloudflared` para abrir um túnel temporário da Cloudflare, sem exigir domínio ou conta da Cloudflare. No Windows, se o executável estiver faltando, instale com `winget install --id Cloudflare.cloudflared --exact` e reabra o Cliparia. [Quick Tunnels da Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
- Na mesma rede Wi-Fi, escolha **Na mesma rede Wi-Fi** e selecione a interface do PC. O acesso usa HTTP local. Abra o QR ou cole o link no navegador ou no app Android 10 ou superior. O APK também aceita o endereço HTTPS de um servidor Cliparia protegido com usuário e senha.
- O link dá acesso à revisão, aos envios e aos controles da fila, incluindo destinos, modo automático, intervalo, ordem e status. Ele expira em uma hora. **Encerrar acesso do celular** fecha o link imediatamente para novas ações. A conexão das contas continua no PC.
- O Cliparia precisa ficar rodando no PC ou no servidor que criou o link. Para rodar com o PC desligado, consulte **SERVIDOR.md**.

## Geração mais rápida

- O FFmpeg mede áudio e movimento em uma execução por trecho, quando a fonte é compatível. Se a análise combinada falhar, a leitura separada continua disponível.
- O Whisper transcreve os cortes escolhidos quando as legendas no vídeo ou a geração de texto para a publicação estão ativas e o modelo local está disponível. Com as legendas no vídeo ativadas, se a triagem não encontrar candidatos e houver áudio, o app testa até duas amostras de 12 segundos.
- O app tenta codificar H.264 na NVIDIA (NVENC), inclusive ao preparar Reels para Instagram e Facebook. No Windows, a leitura de H.264 compatível também usa a GPU na triagem em alta resolução e na verificação de clipes recém-exportados. O Cliparia usa a CPU se a aceleração não estiver disponível ou falhar. A transcrição permanece na CPU.
- A verificação visual mantém a amostragem de um quadro por segundo. Quadros consecutivos idênticos reaproveitam o resultado anterior. A aba em segundo plano para de consultar o estado e atualiza ao voltar, enquanto a fila segue no servidor local.
- A geração do próximo corte pode ocorrer enquanto o anterior é enviado ao Drive.

## Parar a clipagem e apagar o histórico

- Use **Parar clipagem** na tarefa ativa. A captura ou análise é interrompida. Um envio ao Drive que já começou pode terminar. Os clipes salvos continuam na tarefa para revisão.
- **Apagar do histórico** remove a tarefa do Cliparia. **Limpar histórico** remove as tarefas encerradas da aba. Tarefas com clipagem, edição ou envio em andamento são mantidas. Os arquivos guardados no Drive são preservados.
- No Android, instale **Cliparia Controle**, que é identificado separadamente. Na tela de cortes, você pode parar uma tarefa ou apagar o histórico.

## Seleção dos melhores momentos

O Cliparia exige evidência de destaque, como ação sustentada com reação, um pico no mapa de replay, uma reação significativa na fala ou movimento visual forte em relação ao trecho anterior e posterior. Um ruído isolado não gera um corte. Se faltarem bons candidatos, a tarefa pode entregar menos cortes ou nenhum.

Quando a plataforma oferece uma faixa de resolução baixa, o app pode usá-la na triagem. O MP4 final é renderizado a partir da faixa original. A transcrição ignora silêncios nas pontas dos cortes, com margem de segurança. Para melhorar a chance de encontrar reações faladas, habilite as legendas e instale o modelo de transcrição.

## Busca não cronológica e recortes separados

Em VODs longos, o Cliparia começa pelas partes mais revistas quando há um mapa de replay. Se não houver bons pontos no mapa, ele observa amostras curtas distribuídas pelo VOD e analisa em detalhe os intervalos mais promissores. Uma sondagem por amostragem pode deixar passar acontecimentos fora das janelas verificadas. Em lives em andamento, o Cliparia só avalia o que já capturou.

No modo vertical, o enquadramento é definido automaticamente a cada novo corte. Quando **Gerar legendas automáticas** estiver ativo, o Cliparia tenta recuperar a fala usando o corte inteiro se a transcrição curta falhar. Trechos sem fala reconhecida são descartados nesse modo.
