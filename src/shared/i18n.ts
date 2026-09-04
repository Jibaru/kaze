/**
 * Interface language. Spanish is the default; English is available.
 *
 * A hand-written typed dictionary rather than a library: the surface is ~130
 * strings, the `Dict` interface makes a missing translation a type error, and
 * pulling in i18next to look up static keys in an Electron app with two locales
 * would be paying for machinery nobody uses.
 *
 * Deliberately NOT translated: AWS service names and ids (`RDS`, `n5`), the
 * `kaze-adl` document written to disk, and the gap rule tokens. Those are
 * machine-facing or proper nouns; a design serialized in Spanish would stop
 * matching the findings that reference it.
 */

export type Locale = 'es' | 'en'

export const LOCALES: Locale[] = ['es', 'en']
export const DEFAULT_LOCALE: Locale = 'es'

export const LOCALE_NAMES: Record<Locale, string> = { es: 'Español', en: 'English' }

/** What the model is told to answer in. AWS terminology stays as it is. */
export const REPLY_LANGUAGE: Record<Locale, string> = {
  es: 'Responde íntegramente en español, incluido el campo spoken_summary. Mantén en inglés los nombres de servicios de AWS, los identificadores de nodo y los ids de best practice.',
  en: 'Reply in English.',
}

/** BCP-47 tags for the speech APIs. */
export const SPEECH_LANGUAGE: Record<Locale, string> = { es: 'es', en: 'en' }

export interface Dict {
  // ── rails ────────────────────────────────────────────────────────────
  scenario: string
  boundaries: string
  services: string
  edgeStyle: string
  edgeStyleName: Record<string, string>
  background: string
  backgroundName: Record<string, string>
  cycleTo: (name: string) => string
  copyImage: string
  copyText: string
  textCopied: (lines: number) => string
  flipEdge: string
  flipEdgeHint: string
  edgesFlipped: (n: number) => string
  applyFix: string
  applyingFix: string
  fixApplied: (changes: string) => string
  fixRejected: (reason: string) => string
  fixNothing: string
  undo: string
  undone: string
  newSession: string
  newSessionTitle: string
  newSessionDetail: string
  newSessionConfirm: string
  newSessionCancel: string
  sessionArchived: string
  imageCopied: (width: number, height: number) => string
  nothingToCopy: string
  copyFailed: (reason: string) => string
  noScenarios: string
  scenarioLabel: string
  newScenario: string
  scenarioActions: string
  newScenarioCancel: string
  topicLabel: string
  topicPlaceholder: string
  difficulty: string
  difficultyLevel: (n: number) => string
  createScenario: string
  creatingScenario: string
  scenarioCreated: (title: string) => string
  openScenarioFolder: string
  rubricStaysHidden: string
  authorFailed: Record<string, string>

  // ── palette ──────────────────────────────────────────────────────────
  searchServices: string
  searchPlaceholder: string
  noMatches: (query: string) => string
  addService: (name: string) => string

  // ── tabs ─────────────────────────────────────────────────────────────
  tabInspector: string
  tabDesignText: string
  tabReview: string

  // ── inspector ────────────────────────────────────────────────────────
  selectNode: string
  selectNodeHint: string
  label: string
  connection: string
  connections: (n: number) => string
  protocol: string
  protocolPlaceholder: string
  protocolHint: string
  edgeLabel: string
  edgeLabelPlaceholder: string
  mixedValues: string
  deleteConnection: string
  deleteConnections: (n: number) => string
  deleteBoundary: string
  deleteNode: string
  noProps: string
  notSet: string

  // ── design text ──────────────────────────────────────────────────────
  gaps: string
  noGaps: string
  whatReviewerReads: string

  // ── review ───────────────────────────────────────────────────────────
  noReview: string
  noReviewHint: string
  transcript: string
  revisionN: (n: number) => string
  fixedCount: (n: number) => string
  noLongerRaisedCount: (n: number) => string
  fixedInRevision: (n: number) => string
  noLongerRaisedAt: (n: number) => string
  unfixedFor: (n: number) => string
  verdictSolid: string
  verdictNeedsWork: string
  verdictDoesNotMeet: string
  statusNew: string
  statusOpen: string
  statusRegressed: string
  statusFixed: string

  // ── status bar ───────────────────────────────────────────────────────
  holdToTalk: string
  listening: string
  transcribing: string
  micHint: string
  review: string
  reviewing: string
  thinking: string
  chatMode: string
  chatModeHint: string
  chatState: Record<string, string>
  chatYou: string
  chatMute: string
  chatUnmute: string
  chatMuteHint: string
  chatInterrupt: string
  chatExit: string
  chatNoKey: string
  chatDrew: (changes: string) => string
  fastMode: string
  fastModeHint: string
  fastModeOn: string
  fastModeOff: string
  stop: string
  replay: string
  stopPlayback: string
  askButton: string
  askPlaceholder: string
  askLabel: string
  askHint: string
  keyPlaceholder: string
  keyLabel: string
  save: string
  saveUnsaved: string
  unsavedChanges: string
  snapshot: string
  reload: string
  counts: (services: number, edges: number) => string
  language: string

  // ── status messages ──────────────────────────────────────────────────
  savedNodes: (n: number, path: string) => string
  nothingSaved: string
  loaded: (nodes: number, edges: number) => string
  revisionWritten: (revision: number, changes: number) => string
  doneIn: (seconds: number, cost: number) => string
  turnError: string
  cancelled: string
  voiceEnabled: string
  micDenied: string
  heardNothing: string
  heardNothingMic: string
  noKey: string
  turnInFlight: string
  noEncryption: string
  couldNotSpeak: (reason: string) => string
  unexpectedTools: (tools: string) => string
  noFindingsBlock: string
  notAPayload: string
  askingAgain: (problem: string) => string

  // ── gaps: the rule name, and the sentence built from its parts ───────
  gapRule: Record<string, string>
  gapDetail: (rule: string, subject: string, extra?: string) => string

  // ── the service manifest ─────────────────────────────────────────────
  category: Record<string, string>
  prop: Record<string, string>
  propPlaceholder: Record<string, string>
}

const es: Dict = {
  scenario: 'Escenario',
  boundaries: 'Límites',
  services: 'Servicios',
  edgeStyle: 'Línea',
  edgeStyleName: {
    bezier: 'Curva',
    smoothstep: 'En ángulo redondeado',
    step: 'En ángulo recto',
    straight: 'Recta',
  },
  background: 'Fondo',
  backgroundName: { dots: 'Puntos', grid: 'Cuadrícula', none: 'Liso' },
  cycleTo: (name) => `pulsa para cambiar a ${name.toLowerCase()}`,
  copyImage: 'Copiar el diagrama como imagen',
  copyText: 'Copiar el diagrama como texto',
  textCopied: (n) => `Texto del diagrama copiado · ${n} ${n === 1 ? 'línea' : 'líneas'}`,
  flipEdge: 'Invertir el sentido de la conexión',
  flipEdgeHint: 'Selecciona una conexión para invertirla',
  edgesFlipped: (n) => `${n} ${n === 1 ? 'conexión invertida' : 'conexiones invertidas'}`,
  applyFix: 'Aplicar',
  applyingFix: 'Aplicando…',
  fixApplied: (changes) => `Aplicado: ${changes}`,
  fixRejected: (reason) => `Se descartó parte del cambio: ${reason}`,
  fixNothing: 'El modelo no propuso ningún cambio aplicable.',
  undo: 'Deshacer',
  undone: 'Cambio deshecho.',
  newSession: 'Empezar de cero',
  newSessionTitle: '¿Empezar una sesión nueva?',
  newSessionDetail:
    'Se archiva el intento actual —diagrama, hallazgos, revisiones y audio— y empiezas con el lienzo vacío y una conversación nueva. No se borra nada: queda en attempts/archive.',
  newSessionConfirm: 'Archivar y empezar',
  newSessionCancel: 'Cancelar',
  sessionArchived: 'Intento archivado. Sesión nueva.',
  imageCopied: (w, h) => `Diagrama copiado al portapapeles · ${w}×${h}`,
  nothingToCopy: 'No hay nada que copiar todavía.',
  copyFailed: (reason) => `No se pudo copiar el diagrama: ${reason}`,
  noScenarios: 'No hay escenarios en el espacio de trabajo.',
  scenarioLabel: 'Escenario de práctica',
  newScenario: 'Nuevo escenario',
  scenarioActions: 'Acciones del escenario',
  newScenarioCancel: 'Cancelar',
  topicLabel: 'Tema',
  topicPlaceholder: 'p. ej. el feed de una red social, o reservas de vuelos con inventario limitado',
  difficulty: 'Dificultad',
  difficultyLevel: (n) => ['', 'Primera entrevista', 'Intermedia', 'Senior'][n] ?? String(n),
  createScenario: 'Crear',
  creatingScenario: 'Escribiendo el escenario…',
  scenarioCreated: (title) => `Escenario creado: ${title}`,
  openScenarioFolder: 'Abrir la carpeta de escenarios',
  rubricStaysHidden:
    'Claude escribe el enunciado y la rúbrica con la que se te evaluará. La rúbrica queda oculta a propósito: si la lees, dejas de practicar.',
  authorFailed: {
    'no-block': 'La respuesta no traía un archivo de escenario.',
    'no-frontmatter': 'El escenario generado no tiene cabecera; no se guardó.',
    'no-rubric': 'El escenario generado no traía rúbrica, así que no se podría evaluar. No se guardó.',
  },

  searchServices: 'Buscar servicios de AWS',
  searchPlaceholder: 'Buscar servicios — prueba «redis», «cola»',
  noMatches: (q) => `Nada coincide con «${q}».`,
  addService: (name) => `Añadir ${name}`,

  tabInspector: 'Detalles',
  tabDesignText: 'Texto',
  tabReview: 'Revisión',

  selectNode: 'Selecciona un nodo para configurarlo.',
  selectNodeHint: 'Lo que dejas en blanco es lo que se señala: las omisiones son hallazgos.',
  label: 'Etiqueta',
  connection: 'Conexión',
  connections: (n) => `${n} conexiones`,
  protocol: 'Protocolo',
  protocolPlaceholder: 'HTTPS, gRPC, SQL…',
  protocolHint: 'Una conexión sin protocolo aparece como omisión en el texto del diseño.',
  edgeLabel: 'Nota',
  edgeLabelPlaceholder: 'lo que viaja por aquí',
  mixedValues: '— varios —',
  deleteConnection: 'Eliminar conexión',
  deleteConnections: (n) => `Eliminar ${n} conexiones`,
  deleteBoundary: 'Eliminar límite',
  deleteNode: 'Eliminar nodo',
  noProps: 'Este servicio no tiene propiedades configurables.',
  notSet: '— sin definir —',

  gaps: 'Omisiones',
  noGaps: 'No falta nada evidente. Lo que queda es el diseño en sí, y para eso está la revisión.',
  whatReviewerReads: 'Lo que lee el revisor',

  noReview: 'Todavía no hay revisión.',
  noReviewHint:
    'Dibuja un diseño y pide una revisión. Cada una es una revisión numerada, así que la siguiente puede decirte si tu cambio funcionó.',
  transcript: 'Transcripción',
  revisionN: (n) => `revisión ${n}`,
  fixedCount: (n) => `Corregido (${n})`,
  noLongerRaisedCount: (n) => `${n} ya no se menciona${n === 1 ? '' : 'n'}`,
  fixedInRevision: (n) => `corregido en la revisión ${n}`,
  noLongerRaisedAt: (n) => `ya no se menciona desde la revisión ${n}`,
  unfixedFor: (n) => `sin corregir durante ${n} ${n === 1 ? 'revisión' : 'revisiones'}`,
  verdictSolid: 'Sólido',
  verdictNeedsWork: 'Necesita trabajo',
  verdictDoesNotMeet: 'No cumple el enunciado',
  statusNew: 'nuevo',
  statusOpen: 'sigue abierto',
  statusRegressed: 'reapareció',
  statusFixed: 'corregido',

  holdToTalk: 'Mantén para hablar',
  listening: 'Escuchando…',
  transcribing: 'Transcribiendo…',
  micHint: 'Mantén para hablar — Espacio para revisar, Mayús+Espacio para preguntar',
  review: 'Revisar',
  reviewing: 'Revisando…',
  thinking: 'Pensando…',
  chatMode: 'Conversar',
  chatModeHint:
    'Modo conversación: solo el diagrama, micrófono abierto. Le dices qué añadir y lo dibuja. Sales cuando quieras.',
  chatState: {
    listening: 'Escuchando',
    hearing: 'Te escucho',
    transcribing: 'Transcribiendo',
    thinking: 'Pensando',
    speaking: 'Hablando',
    muted: 'Micrófono apagado',
  },
  chatYou: 'Tú:',
  chatMute: 'Silenciar',
  chatUnmute: 'Activar',
  chatMuteHint: 'Apagar o encender el micrófono. Mientras habla, púlsalo para interrumpir.',
  chatInterrupt: 'Interrumpir y hablar',
  chatExit: 'Salir',
  chatNoKey: 'El modo conversación necesita la clave de OpenAI para oír y hablar.',
  chatDrew: (changes) => `Dibujado: ${changes}`,
  fastMode: 'Rápido',
  fastModeHint:
    'Modo rápido: la revisión llega en una sola vuelta, sin abrir archivos ni consultar la documentación de AWS. Menos hallazgos y sin ids de best practice, pero mucho antes.',
  fastModeOn: 'Modo rápido activado — una vuelta, sin herramientas, hasta tres hallazgos.',
  fastModeOff: 'Modo rápido desactivado — vuelve la revisión completa.',
  stop: 'Detener',
  replay: 'Repetir',
  stopPlayback: 'Detener audio',
  askButton: 'Preguntar',
  askPlaceholder: 'Escribe tu pregunta',
  askLabel: 'Preguntar sobre el diseño actual',
  askHint: 'Intro para enviar · Esc para cerrar',
  keyPlaceholder: 'Pega una clave de OpenAI para activar la voz',
  keyLabel: 'Clave de API de OpenAI, usada solo para voz',
  save: 'Guardar',
  saveUnsaved: 'Guardar — hay cambios sin guardar',
  unsavedChanges: 'Cambios sin guardar',
  snapshot: 'Guardar revisión',
  reload: 'Recargar',
  counts: (s, e) =>
    `${s} ${s === 1 ? 'servicio' : 'servicios'} · ${e} ${e === 1 ? 'conexión' : 'conexiones'}`,
  language: 'Idioma',

  savedNodes: (n, path) => `Guardado: ${n} ${n === 1 ? 'nodo' : 'nodos'} · ${path}`,
  nothingSaved: 'Todavía no hay nada guardado.',
  loaded: (n, e) =>
    `Cargado: ${n} ${n === 1 ? 'nodo' : 'nodos'}, ${e} ${e === 1 ? 'conexión' : 'conexiones'}.`,
  revisionWritten: (r, c) =>
    `Revisión ${r} guardada · ${c} ${c === 1 ? 'cambio' : 'cambios'} desde la anterior`,
  doneIn: (s, cost) => `Listo en ${s} s · $${cost.toFixed(3)}`,
  turnError: 'El turno terminó con un error.',
  cancelled: 'Cancelado.',
  voiceEnabled: 'Voz activada. Mantén Espacio para hablar.',
  micDenied: 'Se denegó el acceso al micrófono.',
  heardNothing: 'No se escuchó nada.',
  heardNothingMic: 'No se escuchó nada. ¿Está seleccionado el micrófono correcto?',
  noKey: 'No hay clave de OpenAI. Añade una en la barra inferior.',
  turnInFlight: 'ya hay un turno en curso',
  noEncryption: 'El cifrado del sistema no está disponible; no se guardará la clave en texto plano.',
  couldNotSpeak: (reason) => `No se pudo leer el resumen en voz alta: ${reason}`,
  unexpectedTools: (tools) => `La sesión ofrece herramientas inesperadas: ${tools}`,
  noFindingsBlock: 'la revisión no incluyó el bloque de hallazgos',
  notAPayload: 'la revisión terminó en un bloque de código que no es un bloque de hallazgos',
  askingAgain: (problem) => `${problem} — se está pidiendo de nuevo`,

  gapRule: {
    unconnected_node: 'nodo sin conexiones',
    actor_inside_boundary: 'actor dentro de un límite',
    unplaced: 'sin ubicar',
    single_az: 'una sola zona',
    no_backup: 'sin respaldo',
    no_scaling_policy: 'sin política de escalado',
    untls_entrypoint: 'entrada sin TLS',
    untyped_edge: 'conexión sin protocolo',
    dangling_edge: 'conexión rota',
    empty_boundary: 'límite vacío',
    no_observability: 'sin observabilidad',
  },
  gapDetail: (rule, subject, extra) => {
    switch (rule) {
      case 'unconnected_node':
        return `${subject} no tiene conexiones de entrada ni de salida`
      case 'actor_inside_boundary':
        return `${subject} está dibujado dentro de ${extra}, pero un actor está fuera del sistema, no dentro de tu red`
      case 'unplaced':
        return `${subject} está fuera de todo límite, así que su ubicación y su radio de impacto quedan sin declarar`
      case 'single_az':
        return `${subject} está en una sola zona de disponibilidad (${extra}) y no tiene la propiedad multi_az`
      case 'no_backup':
        return `${subject} guarda estado sin política de respaldo ni de retención declarada`
      case 'no_scaling_policy':
        return `${subject} no tiene política de escalado, así que su comportamiento bajo carga queda sin declarar`
      case 'untls_entrypoint':
        return `${subject} está expuesto a internet sin terminación TLS declarada`
      case 'untyped_edge':
        return `${subject} no tiene protocolo`
      case 'dangling_edge':
        return `${subject} apunta a un nodo que no está en el diseño`
      case 'empty_boundary':
        return `el límite ${subject} no contiene nada`
      case 'no_observability':
        return 'nada en el diseño lo monitorea: no se muestran métricas, registros ni alarmas'
      default:
        return subject
    }
  },

  category: {
    Actors: 'Actores',
    Compute: 'Cómputo',
    Containers: 'Contenedores',
    Storage: 'Almacenamiento',
    Database: 'Bases de datos',
    Networking: 'Redes',
    Edge: 'Borde',
    Integration: 'Integración',
    Analytics: 'Analítica',
    Security: 'Seguridad',
    Observability: 'Observabilidad',
    Other: 'Otros',
  },
  prop: {
    channel: 'Canal',
    scale: 'Volumen',
    kind: '¿Qué es?',
    notes: 'Notas',
    multi_az: 'Multi-AZ',
    backup: 'Respaldo / retención',
    instance_class: 'Clase de instancia',
    read_replicas: 'Réplicas de lectura',
    autoscaling: 'Política de escalado',
    tls: 'Termina TLS aquí',
    routing_policy: 'Política de enrutamiento',
    cache_policy: 'Política de caché',
    rules: 'Conjunto de reglas',
    health_check: 'Comprobación de salud',
    throttle: 'Límite / cuota',
    authorizer: 'Autorizador',
    concurrency: 'Límite de concurrencia',
    timeout: 'Tiempo de espera',
    launch_type: 'Tipo de lanzamiento',
    engine: 'Motor',
    partition_key: 'Clave de partición',
    capacity: 'Capacidad',
    gsi: 'Índices secundarios',
    eviction: 'Expulsión / TTL',
    versioning: 'Versionado',
    lifecycle: 'Ciclo de vida',
    encryption: 'Cifrado',
    dlq: 'Cola de mensajes fallidos',
    fifo: 'FIFO',
    visibility_timeout: 'Tiempo de visibilidad',
    pattern: 'Patrón',
    shards: 'Particiones',
    retention: 'Retención',
    rotation: 'Rotación activada',
    alarms: 'Alarmas',
  },
  propPlaceholder: {
    scale: 'p. ej. 100 M de redirecciones al día, pico 10x',
    kind: 'p. ej. Kafka, un CDN de terceros, un ERP existente',
    notes: 'p. ej. lo mantiene otro equipo, SLA de 99,9 %',
    backup: 'p. ej. PITR, 7 días',
    instance_class: 'p. ej. db.r6g.large',
    read_replicas: 'p. ej. 2',
    autoscaling: 'p. ej. objetivo 60 % CPU, 2-20',
    cache_policy: 'p. ej. TTL de 60 s en /r/*',
    rules: 'p. ej. límite de 2000/5 min',
    health_check: 'p. ej. GET /healthz',
    throttle: 'p. ej. 10k rps, ráfaga 5k',
    concurrency: 'p. ej. 200 reservadas',
    timeout: 'p. ej. 30 s',
    partition_key: 'p. ej. short_code',
    gsi: 'p. ej. by_user_id',
    eviction: 'p. ej. allkeys-lru, 1 h',
    lifecycle: 'p. ej. IA a los 30 d, Glacier a los 90 d',
    visibility_timeout: 'p. ej. 30 s',
    pattern: 'p. ej. saga con compensaciones',
    shards: 'p. ej. 16',
    retention: 'p. ej. 24 h',
    alarms: 'p. ej. p99 > 200 ms durante 5 min',
  },
}

const en: Dict = {
  scenario: 'Scenario',
  boundaries: 'Boundaries',
  services: 'Services',
  edgeStyle: 'Line',
  edgeStyleName: {
    bezier: 'Curved',
    smoothstep: 'Rounded right angle',
    step: 'Right angle',
    straight: 'Straight',
  },
  background: 'Background',
  backgroundName: { dots: 'Dots', grid: 'Grid', none: 'Plain' },
  cycleTo: (name) => `click for ${name.toLowerCase()}`,
  copyImage: 'Copy the diagram as an image',
  copyText: 'Copy the diagram as text',
  textCopied: (n) => `Diagram text copied · ${n} line${n === 1 ? '' : 's'}`,
  flipEdge: 'Reverse the connection',
  flipEdgeHint: 'Select a connection to reverse it',
  edgesFlipped: (n) => `${n} connection${n === 1 ? '' : 's'} reversed`,
  applyFix: 'Apply',
  applyingFix: 'Applying…',
  fixApplied: (changes) => `Applied: ${changes}`,
  fixRejected: (reason) => `Part of the change was refused: ${reason}`,
  fixNothing: 'The model proposed nothing that could be applied.',
  undo: 'Undo',
  undone: 'Change undone.',
  newSession: 'Start fresh',
  newSessionTitle: 'Start a new session?',
  newSessionDetail:
    'The current attempt — diagram, findings, revisions and audio — is archived, and you start with an empty canvas and a new conversation. Nothing is deleted: it stays in attempts/archive.',
  newSessionConfirm: 'Archive and start',
  newSessionCancel: 'Cancel',
  sessionArchived: 'Attempt archived. New session.',
  imageCopied: (w, h) => `Diagram copied to the clipboard · ${w}×${h}`,
  nothingToCopy: 'Nothing to copy yet.',
  copyFailed: (reason) => `Could not copy the diagram: ${reason}`,
  noScenarios: 'No scenarios found in the workspace.',
  scenarioLabel: 'Practice scenario',
  newScenario: 'New scenario',
  scenarioActions: 'Scenario actions',
  newScenarioCancel: 'Cancel',
  topicLabel: 'Topic',
  topicPlaceholder: 'e.g. a social feed, or flight booking with limited inventory',
  difficulty: 'Difficulty',
  difficultyLevel: (n) => ['', 'First interview', 'Intermediate', 'Senior'][n] ?? String(n),
  createScenario: 'Create',
  creatingScenario: 'Writing the scenario…',
  scenarioCreated: (title) => `Scenario created: ${title}`,
  openScenarioFolder: 'Open the scenarios folder',
  rubricStaysHidden:
    'Claude writes the brief and the rubric you will be graded against. The rubric stays hidden on purpose: read it and you stop practising.',
  authorFailed: {
    'no-block': 'The reply did not contain a scenario file.',
    'no-frontmatter': 'The generated scenario has no frontmatter, so it was not saved.',
    'no-rubric': 'The generated scenario had no rubric, so it could not be graded. It was not saved.',
  },

  searchServices: 'Search AWS services',
  searchPlaceholder: 'Search services — try “redis”, “queue”',
  noMatches: (q) => `Nothing matches “${q}”.`,
  addService: (name) => `Add ${name}`,

  tabInspector: 'Inspector',
  tabDesignText: 'Design text',
  tabReview: 'Review',

  selectNode: 'Select a node to configure it.',
  selectNodeHint: 'What you leave blank is what gets flagged — omissions are findings.',
  label: 'Label',
  connection: 'Connection',
  connections: (n) => `${n} connections`,
  protocol: 'Protocol',
  protocolPlaceholder: 'HTTPS, gRPC, SQL…',
  protocolHint: 'A connection with no protocol shows up as a gap in the design text.',
  edgeLabel: 'Note',
  edgeLabelPlaceholder: 'what travels along it',
  mixedValues: '— mixed —',
  deleteConnection: 'Delete connection',
  deleteConnections: (n) => `Delete ${n} connections`,
  deleteBoundary: 'Delete boundary',
  deleteNode: 'Delete node',
  noProps: 'No configurable properties for this service.',
  notSet: '— not set —',

  gaps: 'Gaps',
  noGaps: 'Nothing obviously omitted. What is left is the design itself — that is what the review is for.',
  whatReviewerReads: 'What the reviewer reads',

  noReview: 'No review yet.',
  noReviewHint:
    'Draw a design, then ask for a review. Each one is a numbered revision, so the next review can tell you whether what you changed actually worked.',
  transcript: 'Transcript',
  revisionN: (n) => `revision ${n}`,
  fixedCount: (n) => `Fixed (${n})`,
  noLongerRaisedCount: (n) => `${n} no longer raised`,
  fixedInRevision: (n) => `fixed in revision ${n}`,
  noLongerRaisedAt: (n) => `no longer raised as of revision ${n}`,
  unfixedFor: (n) => `unfixed for ${n} revision${n === 1 ? '' : 's'}`,
  verdictSolid: 'Solid',
  verdictNeedsWork: 'Needs work',
  verdictDoesNotMeet: 'Does not meet the brief',
  statusNew: 'new',
  statusOpen: 'still open',
  statusRegressed: 'regressed',
  statusFixed: 'fixed',

  holdToTalk: 'Hold to talk',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  micHint: 'Hold to speak — Space for a review, Shift+Space to ask',
  review: 'Review',
  reviewing: 'Reviewing…',
  thinking: 'Thinking…',
  chatMode: 'Converse',
  chatModeHint:
    'Conversation mode: the diagram and nothing else, microphone open. Tell it what to add and it draws. Leave whenever you like.',
  chatState: {
    listening: 'Listening',
    hearing: 'Hearing you',
    transcribing: 'Transcribing',
    thinking: 'Thinking',
    speaking: 'Speaking',
    muted: 'Microphone off',
  },
  chatYou: 'You:',
  chatMute: 'Mute',
  chatUnmute: 'Unmute',
  chatMuteHint: 'Turn the microphone off or on. While it is speaking, press to interrupt.',
  chatInterrupt: 'Interrupt and speak',
  chatExit: 'Leave',
  chatNoKey: 'Conversation mode needs the OpenAI key to hear and speak.',
  chatDrew: (changes) => `Drew: ${changes}`,
  fastMode: 'Fast',
  fastModeHint:
    'Fast mode: the review comes back in a single round trip, with no files opened and no AWS documentation consulted. Fewer findings and no best-practice ids, but far sooner.',
  fastModeOn: 'Fast mode on — one round trip, no tools, up to three findings.',
  fastModeOff: 'Fast mode off — the full review is back.',
  stop: 'Stop',
  replay: 'Replay',
  stopPlayback: 'Stop audio',
  askButton: 'Ask',
  askPlaceholder: 'Type your question',
  askLabel: 'Ask a question about the current design',
  askHint: 'Enter to send · Esc to close',
  keyPlaceholder: 'Paste an OpenAI key to enable voice',
  keyLabel: 'OpenAI API key, used only for speech',
  save: 'Save',
  saveUnsaved: 'Save — unsaved changes',
  unsavedChanges: 'Unsaved changes',
  snapshot: 'Snapshot revision',
  reload: 'Reload',
  counts: (s, e) => `${s} service${s === 1 ? '' : 's'} · ${e} edge${e === 1 ? '' : 's'}`,
  language: 'Language',

  savedNodes: (n, path) => `Saved ${n} node${n === 1 ? '' : 's'} · ${path}`,
  nothingSaved: 'Nothing saved yet.',
  loaded: (n, e) => `Loaded ${n} node${n === 1 ? '' : 's'}, ${e} edge${e === 1 ? '' : 's'}.`,
  revisionWritten: (r, c) => `Revision ${r} written · ${c} change${c === 1 ? '' : 's'} since the last one`,
  doneIn: (s, cost) => `Done in ${s}s · $${cost.toFixed(3)}`,
  turnError: 'The turn ended with an error.',
  cancelled: 'Cancelled.',
  voiceEnabled: 'Voice enabled. Hold Space to talk.',
  micDenied: 'Microphone access was denied.',
  heardNothing: 'Heard nothing.',
  heardNothingMic: 'Heard nothing — is the right microphone selected?',
  noKey: 'No OpenAI key set. Add one in the voice bar.',
  turnInFlight: 'a turn is already in flight',
  noEncryption: 'OS encryption is unavailable, refusing to store the key in plaintext',
  couldNotSpeak: (reason) => `could not speak the summary: ${reason}`,
  unexpectedTools: (tools) => `session offers unexpected tools: ${tools}`,
  noFindingsBlock: 'the review did not include a findings block',
  notAPayload: 'the review ended with a code block that is not a findings payload',
  askingAgain: (problem) => `${problem} — asking for it again`,

  gapRule: {
    unconnected_node: 'unconnected node',
    actor_inside_boundary: 'actor inside a boundary',
    unplaced: 'unplaced',
    single_az: 'single AZ',
    no_backup: 'no backup',
    no_scaling_policy: 'no scaling policy',
    untls_entrypoint: 'entry point without TLS',
    untyped_edge: 'untyped edge',
    dangling_edge: 'dangling edge',
    empty_boundary: 'empty boundary',
    no_observability: 'no observability',
  },
  gapDetail: (rule, subject, extra) => {
    switch (rule) {
      case 'unconnected_node':
        return `${subject} has no inbound or outbound edges`
      case 'actor_inside_boundary':
        return `${subject} is drawn inside ${extra}, but an actor sits outside the system rather than in your network`
      case 'unplaced':
        return `${subject} sits outside every boundary, so its placement and blast radius are unstated`
      case 'single_az':
        return `${subject} sits in one AZ (${extra}) with no multi_az prop`
      case 'no_backup':
        return `${subject} holds state with no backup or retention policy stated`
      case 'no_scaling_policy':
        return `${subject} has no scaling policy, so its behaviour under load is unstated`
      case 'untls_entrypoint':
        return `${subject} faces the internet with no TLS termination stated`
      case 'untyped_edge':
        return `${subject} has no protocol`
      case 'dangling_edge':
        return `${subject} references a node that is not in the design`
      case 'empty_boundary':
        return `boundary ${subject} contains nothing`
      case 'no_observability':
        return 'nothing in the design monitors it: no metrics, logs or alarms are shown'
      default:
        return subject
    }
  },

  category: {
    Actors: 'Actors',
    Compute: 'Compute',
    Containers: 'Containers',
    Storage: 'Storage',
    Database: 'Database',
    Networking: 'Networking',
    Edge: 'Edge',
    Integration: 'Integration',
    Analytics: 'Analytics',
    Security: 'Security',
    Observability: 'Observability',
    Other: 'Other',
  },
  prop: {
    channel: 'Channel',
    scale: 'Volume',
    kind: 'What is it?',
    notes: 'Notes',
    multi_az: 'Multi-AZ',
    backup: 'Backup / retention',
    instance_class: 'Instance class',
    read_replicas: 'Read replicas',
    autoscaling: 'Scaling policy',
    tls: 'TLS terminated here',
    routing_policy: 'Routing policy',
    cache_policy: 'Cache policy',
    rules: 'Rule set',
    health_check: 'Health check',
    throttle: 'Throttle / quota',
    authorizer: 'Authorizer',
    concurrency: 'Concurrency limit',
    timeout: 'Timeout',
    launch_type: 'Launch type',
    engine: 'Engine',
    partition_key: 'Partition key',
    capacity: 'Capacity',
    gsi: 'GSIs',
    eviction: 'Eviction / TTL',
    versioning: 'Versioning',
    lifecycle: 'Lifecycle',
    encryption: 'Encryption',
    dlq: 'Dead-letter queue',
    fifo: 'FIFO',
    visibility_timeout: 'Visibility timeout',
    pattern: 'Pattern',
    shards: 'Shards',
    retention: 'Retention',
    rotation: 'Rotation enabled',
    alarms: 'Alarms',
  },
  propPlaceholder: {
    scale: 'e.g. 100M redirects/day, 10x peak',
    kind: 'e.g. Kafka, a third-party CDN, an existing ERP',
    notes: 'e.g. owned by another team, 99.9% SLA',
    backup: 'e.g. PITR, 7 days',
    instance_class: 'e.g. db.r6g.large',
    read_replicas: 'e.g. 2',
    autoscaling: 'e.g. target 60% CPU, 2-20',
    cache_policy: 'e.g. 60s TTL on /r/*',
    rules: 'e.g. rate limit 2000/5min',
    health_check: 'e.g. GET /healthz',
    throttle: 'e.g. 10k rps burst 5k',
    concurrency: 'e.g. reserved 200',
    timeout: 'e.g. 30s',
    partition_key: 'e.g. short_code',
    gsi: 'e.g. by_user_id',
    eviction: 'e.g. allkeys-lru, 1h',
    lifecycle: 'e.g. IA at 30d, Glacier at 90d',
    visibility_timeout: 'e.g. 30s',
    pattern: 'e.g. saga with compensations',
    shards: 'e.g. 16',
    retention: 'e.g. 24h',
    alarms: 'e.g. p99 > 200ms for 5m',
  },
}

export const DICTIONARIES: Record<Locale, Dict> = { es, en }

export const dict = (locale: Locale): Dict => DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE]

/** Narrow an arbitrary string (a stored setting, an OS locale) to a Locale. */
export function toLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE
  const short = value.toLowerCase().split(/[-_]/)[0]
  return (LOCALES as string[]).includes(short!) ? (short as Locale) : DEFAULT_LOCALE
}
