// i18n (CHARTER section 2, invariant 10): every player-facing string goes through `t(key, params?)`. Two tables, `sv` (the
// default language) and `en`, are edited together: `en` is typed `Record<TextKey, string>`, so a key missing from either
// table (or an extra one) does not compile, and `tests/i18n.test.ts` checks the same at run time plus the placeholders and
// that every `t('...')` literal in `src` names a real key. In test mode `setStrictI18n(true)` turns a missing key (or a
// missing placeholder value) into an exception, which the e2e tests see as a page error.
//
// Developer tools (the Dev panel, the perf overlay and its report, the debug pages) are Swedish only on purpose (D98).

import { GOLD_DISPLAY_FACTOR } from './uiConfig';

export type Lang = 'sv' | 'en';
export const LANGUAGES: readonly Lang[] = ['sv', 'en'];
export const DEFAULT_LANGUAGE: Lang = 'sv';

const sv = {
  'app.title': 'Erövra jorden',
  'app.tagline': 'Välj en startplats på jordklotet, bygg ut din nation över berg och slätter och ta mark från stamfolk och AI-nationer.',
  'app.loading': 'Laddar världen...',
  'app.error': 'Kunde inte starta: {message}',

  'start.play': 'Spela',
  'start.dev': 'Dev',
  'start.devAria': 'Öppna Dev-panelen (F2)',
  'start.language': 'English',
  'start.languageAria': 'Byt språk till engelska',
  'start.helpTitle': 'Så spelar du',
  'help.click': 'Klicka på marken: först spawna (gärna inom 15 sekunder, så hamnar AI-länderna nära dig), sedan anfalla fiende- eller oägd mark',
  'help.drag': 'Dra med musen: snurra globen. Mushjul: zooma',
  'help.commit': '[ och ]: insats i steg om 5 % (även - och + fungerar)',
  'help.speed': 'Mellanslag: paus. , och .: långsammare och snabbare',
  'help.dev': 'F2: Dev-panelen. F3: bildfrekvens',
  'start.gpuChosen': 'Spelet kör på {name} och har valt låg grafik för jämn bildfrekvens.',
  'start.gpuBetter': 'Vill du ha finare grafik? Öppna Dev-panelen (F2) och välj Kvalitet: medel, eller skriv #quality-medium sist i adressen.',
  'start.gpuSeparate': 'Har datorn ett separat grafikkort: Windows Inställningar, System, Bildskärm, Grafik, välj webbläsaren, Alternativ, Hög prestanda. Starta om webbläsaren.',
  'start.gpuClose': 'Stäng',
  'start.gpuMore': 'Mer',
  'start.gpuLess': 'Mindre',
  'start.gpuCloseAria': 'Stäng tipset om grafiken',
  'start.gpuNameFallback': 'din dator',

  'hud.gold': 'Guld',
  'hud.goldRate': '+{rate}/s',
  'hud.troops': 'Trupper',
  'hud.cap': 'tak {cap}',
  'hud.nearCap': 'Nära taket',
  'hud.landShare': 'Landandel',
  'hud.timer': 'Tid',
  'hud.leaderboard': 'Ledartavla',
  'hud.leaderboardEmpty': 'Ingen har spawnat än',
  'hud.you': 'Du',
  'hud.nation': 'Nation {n}',
  'hud.tribe': 'Stam {n}',
  'hud.rank': '{n}.',
  'hud.percent': '{n} %',
  'hud.speedLabel': 'Hastighet',
  'hud.pause': 'Paus',
  'hud.speedValue': '{n}x',
  'hud.commit': 'Insats',
  'hud.commitTroops': '{n} trupper',
  'hud.commitAria': 'Insats i procent av trupperna',

  'phase.spawnPick': 'Välj din startplats: klicka på marken',
  'phase.spawnDone': 'Startplats vald. Väntar på att fasen tar slut',
  'phase.spawnMissed': 'Du hann inte välja startplats. Ladda om sidan för en ny match.',
  'phase.immunity': 'Skyddad en kort stund. Gör dig redo att anfalla',
  'phase.play': 'Klicka på fiende- eller oägd mark för att anfalla',
  'phase.seconds': '{s} s',
  'phase.paused': 'Pausat',

  'reject.terrain': 'Du kan inte spawna där (hav, bergstopp eller is).',
  'reject.owned': 'Någon äger redan marken där.',
  'reject.spawned': 'Du har redan spawnat.',
  'reject.phase': 'Det går inte i den här fasen.',
  'reject.immune': 'Skyddad de första sekunderna.',
  'reject.noContact': 'Du gränsar inte till den marken.',
  'reject.noTroops': 'Inga trupper att skicka.',
  'reject.self': 'Det är din egen mark.',
  'reject.notSpawned': 'Spawna först.',
  'reject.amount': 'Ogiltigt belopp.',
  'reject.pct': 'Insatsen måste vara minst 5 %.',
  'reject.other': 'Avvisat (kod {code}).',
  'toast.notConquerable': 'Det går inte att erövra (hav, bergstopp eller is).',

  'tooltip.sea': 'Hav',
  'tooltip.unknownCountry': 'Okänt land',
  'class.0': 'Djuphav',
  'class.1': 'Grunt hav',
  'class.2': 'Slätt',
  'class.3': 'Skog',
  'class.4': 'Kullar',
  'class.5': 'Berg',
  'class.6': 'Bergstopp',
  'class.7': 'Is',

  'setup.reason.tooFewCells': 'Landet har för få celler för en rättvis start: {cells} av {need} celler.',
  'setup.reason.smallLandmass': 'Landmassan är för liten för en rättvis start: {cells} av {need} celler.',
  'setup.reason.noCapitalLand': 'Huvudstaden ligger inte på spelbar mark.',
  'setup.reason.outsideRegion': 'Landet ligger utanför det valda utsnittet.',
  'setup.reason.excluded': 'Landet är inte valbart i spelet.',
  'setup.start.terrain': 'Välj en plats på land (slätt, skog, kullar eller berg).',
  'setup.error.invalid': 'Ogiltig inställning: {field}.',
  'setup.error.neutralNeedsCustom': 'Läget utan riktiga gränser kräver en egen nation.',
  'setup.error.nameTaken': 'Namnet "{name}" tillhör ett riktigt land. Välj ett eget namn.',
  'setup.error.notEnoughCountries': 'Det finns bara {available} lämpliga länder för {wanted} AI-nationer i det här utsnittet.',
  'start.setup': 'Välj land och inställningar',
  'start.playHint': 'Snabbstart: du klickar var du vill börja på jordklotet.',
  'start.setupHint': 'Välj ett riktigt land eller hitta på ett eget, med egen flagga.',
  'phase.preplaced': 'Alla nationer är på plats. Anfall tillåts när nedräkningen är slut',
  'tooltip.land': 'Mark',

  'setup.title': 'Ny match',
  'setup.back': 'Tillbaka',
  'setup.cityStyle': 'Stadsstil: {style}',
  'setup.cityStyleOld': 'Gammal',
  'setup.cityStyleNew': 'Modern',
  'setup.loading': 'Förbereder världen...',
  'setup.tab.real': 'Riktigt land',
  'setup.tab.custom': 'Eget land',
  'setup.search': 'Sök land',
  'setup.searchPlaceholder': 'Sök på svenska eller engelska...',
  'setup.pickHint': 'Eller klicka på ett land på globen.',
  'setup.noMatch': 'Inget land matchar sökningen.',
  'setup.cells': '{cells} celler',
  'setup.cells.one': '{cells} cell',
  'setup.countryOk': '{name} kan väljas. Din startskiva blir {need} celler.',
  'setup.click.sea': 'Det där är hav. Klicka på ett land.',
  'setup.click.unknown': 'Det landet finns inte i listan.',
  'setup.nation.name': 'Nationens namn',
  'setup.nation.defaultName': 'Nyland',
  'setup.nation.color': 'Färg',
  'setup.nation.colorOption': 'Färg {n}',
  'setup.nation.flag': 'Flagga',
  'setup.nation.reroll': 'Ny flagga',
  'setup.nation.place': 'Startplats',
  'setup.nation.placeHint': 'Klicka på land på globen för att välja var du börjar.',
  'setup.nation.placeSet': 'Startplats vald: {lat}, {lon}.',
  'setup.options': 'Matchalternativ',
  'setup.region': 'Område',
  'setup.region.world': 'Hela världen',
  'setup.region.europe': 'Europa',
  'setup.region.eastAsia': 'Östasien',
  'setup.region.americas': 'Amerika',
  'setup.region.africaMiddleEast': 'Afrika och Mellanöstern',
  'setup.ai': 'AI-nationer',
  'setup.aiMax': 'högst {n} här',
  'setup.tribes': 'Stamfolk',
  'setup.difficulty': 'Svårighetsgrad',
  'setup.difficulty.easy': 'Lätt',
  'setup.difficulty.normal': 'Medel',
  'setup.difficulty.hard': 'Svår',
  'setup.difficultyNote': 'Sparas med matchen. AI:n börjar använda den i en senare version.',
  'setup.seed': 'Seed (startvärde)',
  'setup.seedHint': 'Samma val och samma seed ger samma start.',
  'setup.neutral': 'Inga riktiga gränser',
  'setup.neutralHint': 'Inga landsgränser eller landsnamn ritas, AI-nationerna får påhittade namn. Kräver eget land.',
  'setup.disclaimer': 'Stiliserad, fiktiv karta, inga politiska ståndpunkter.',
  'setup.sources': 'Gränser och namn följer de faktiska linjerna i Natural Earth; omstridda områden har neutrala namn.',
  'setup.start': 'Starta matchen',
  'setup.starting': 'Bygger världen...',
  'setup.need.country': 'Välj ett land i listan eller på globen.',
  'setup.need.name': 'Skriv ett namn på din nation (högst 24 tecken).',
  'setup.need.cell': 'Klicka på land på globen för att välja startplats.',
  'setup.need.seed': 'Seed måste vara ett heltal.',
  'setup.error.start': 'Matchen kunde inte byggas: {reason}',

  'hud.build.bar': 'Byggfält',
  'hud.build.city': 'Stad',
  'hud.build.cityTip': 'Bygg en stad (tangent 1). Pris: {price} guld.',
  'hud.build.cityCost': '{price}',
  'hud.build.tooPoor': 'För lite guld: en stad kostar {price} guld.',
  'hud.build.placing': 'Klicka på din mark för att placera. Shift + klick: flera. Esc eller högerklick: avbryt.',
  'toast.build.notOwned': 'Du kan bara bygga på din egen mark.',
  'toast.build.peak': 'Det går inte att bygga på en bergstopp.',
  'toast.build.mountain': 'Det går inte att bygga det på berg.',
  'toast.build.hills': 'En hamn går inte att bygga på kullar.',
  'toast.build.forest': 'En silo går inte att bygga i skog.',
  'toast.build.noCoast': 'En hamn måste ligga vid kusten.',
  'toast.build.occupied': 'Det finns redan en byggnad där.',
  'toast.build.spacing': 'För nära en annan byggnad av samma sort.',
  'toast.build.fallout': 'Marken är förorenad av nedfall.',
  'toast.build.noFactory': 'En silo kräver en färdig fabrik.',
  'toast.build.gold': 'För lite guld.',
  'toast.build.phase': 'Vänta tills startfasen är slut innan du bygger.',
  'hud.build.waitPhase': 'Vänta tills startfasen är slut.',
  'sel.why.phase': 'Vänta tills startfasen är slut.',
  'toast.build.full': 'Det finns inte plats för fler byggnader.',
  'hud.build.factory': 'Fabrik',
  'hud.build.factoryTip': 'Bygg en fabrik (tangent 2). Pris: {price} guld.',
  'hud.build.tooPoorFactory': 'För lite guld: en fabrik kostar {price} guld.',
  'hud.build.port': 'Hamn',
  'hud.build.portTip': 'Bygg en hamn vid kusten (tangent 3). Pris: {price} guld.',
  'hud.build.tooPoorPort': 'För lite guld: en hamn kostar {price} guld.',
  'hud.build.silo': 'Missilsilo',
  'hud.build.siloTip': 'Bygg en silo (tangent 4). Kräver en färdig egen fabrik. Pris: {price} guld.',
  'hud.build.sam': 'Luftvärn',
  'hud.build.samTip': 'Bygg ett luftvärn (SAM, tangent 5). Kan stå på berg. Pris: {price} guld.',
  'hud.build.post': 'Försvarspost',
  'hud.build.postTip': 'Bygg en försvarspost (tangent 6). Kan stå på berg. Pris: {price} guld.',
  'hud.build.tooPoorOf': 'För lite guld: {name} kostar {price} guld.',
  'hud.build.needFactory': '{name} kräver en färdig egen fabrik.',
  'sel.panel': 'Vald byggnad',
  'sel.level': 'Nivå {level}',
  'sel.levelTop': 'Nivå {level} (högsta)',
  'sel.fxNext': 'Nästa nivå: {fx}',
  'sel.owner.you': 'din',
  'sel.owner.other': 'någon annans',
  'sel.state.building': 'Under konstruktion',
  'sel.state.upgrading': 'Uppgraderas...',
  'sel.fx.city': 'Ger {gold} guld/s och {troops} högre trupptak.',
  'sel.fx.factory': 'Ger {gold} guld/s och {pct} % mer inkomst från städer inom {radius} rutor.',
  'sel.fx.port': 'Ger {gold} guld/s och handel med andra hamnar ({pct} % av handelsvärdet).',
  'sel.fx.silo': 'Missilsilo: har ingen funktion än, missiler kommer senare.',
  'sel.fx.sam': 'Luftvärn: räckvidd {radius} rutor ({pct} % längre på berg).',
  'sel.fx.post': 'Gör fiendens erövring {mult} gånger dyrare inom {radius} rutor.',
  'sel.upgrade': 'Uppgradera ({price})',
  'sel.upgradeMax': 'Högsta nivå',
  'sel.upgradeTip': 'Uppgradera till nivå {level} för {price} guld. Tar {seconds} s.',
  'sel.delete': 'Riv',
  'sel.deleteTip': 'Riv byggnaden. Ingen ersättning, och du får vänta {seconds} s innan du kan riva igen.',
  'sel.why.notOwner': 'Byggnaden är inte din.',
  'sel.why.gold': 'För lite guld: uppgraderingen kostar {price} guld.',
  'sel.why.maxLevel': 'Byggnaden har redan högsta nivån.',
  'sel.why.busy': 'Byggnaden är under konstruktion eller uppgraderas.',
  'sel.why.cooldown': 'Rivning väntar: {seconds} s kvar.',
  'sel.why.gone': 'Byggnaden finns inte längre.',
  'sel.hint': 'Esc eller klick på tom mark: avmarkera.',
  'sel.deleteConfirm': 'Bekräfta',
  'sel.deleteConfirmTip': 'Klicka igen inom några sekunder för att riva byggnaden. Ingen ersättning.',
  'toast.struct.gone': 'Byggnaden finns inte längre.',
  'toast.struct.notOwner': 'Byggnaden är inte din.',
  'toast.struct.maxLevel': 'Byggnaden har redan högsta nivån.',
  'toast.struct.busy': 'Byggnaden är under konstruktion eller uppgraderas.',
  'toast.struct.cooldown': 'Rivning väntar, försök igen om en stund.',
  // Districts-2a (city view)
  'sel.city.open': 'Öppna stad',
  'sel.city.openTip': 'Öppna stadsvyn: bygg och uppgradera distrikt i staden.',
  'sel.city.close': 'Stäng',
  'sel.city.panel': 'Stadsvy',
  'sel.city.title': 'Stad, nivå {level}',
  'sel.city.titleTop': 'Stad, nivå {level} (högsta)',
  'sel.city.upgrade': 'Uppgradera staden ({price})',
  'sel.city.upgradeMax': 'Högsta nivå',
  'sel.city.upgradeTip': 'Uppgradera staden till nivå {level} för {price} guld. Tar {seconds} s. Mer guld och fler trupper.',
  'sel.city.stateBuilding': 'Staden byggs...',
  'sel.city.stateUpgrading': 'Staden uppgraderas...',
  'sel.city.totalsGold': 'Guld: {gold}/s',
  'sel.city.totalsTroops': 'Trupptak: {troops}',
  'sel.city.totalsRegen': 'Regenerering: +{pct} %',
  'sel.city.totalsWalls': 'Murar: x{mult}',
  'sel.city.totalsWallsNone': 'Murar: inga',
  'sel.city.hint': 'Esc eller Stäng: tillbaka till kartan.',
  'sel.city.tile': 'Plats {n}',
  'sel.city.tileEmpty': 'Tom plats. Välj vad som ska byggas:',
  'sel.city.tileProgress': '{pct} % klart',
  'sel.district.housing': 'Bostäder',
  'sel.district.market': 'Marknad',
  'sel.district.barracks': 'Kasern',
  'sel.district.walls': 'Murar',
  'sel.district.fxHousing': '+{troops} trupptak',
  'sel.district.fxMarket': '+{gold} guld/s',
  'sel.district.fxBarracks': '+{pct} % truppregenerering',
  'sel.district.fxWalls': 'Fiendens erövring x{mult} dyrare på stadens ruta och {radius} rutor runt',
  'sel.district.build': '{name}: {price}', // factor 100: five-digit prices; the word gold is in the tooltip, the upgrade buttons show the bare number too
  'sel.district.buildTime': 'Byggtid {seconds} s',
  'sel.district.buildTip': 'Bygg {name} för {price} guld. Byggtid {seconds} s. {fx}',
  'sel.district.level': 'Nivå {level}',
  'sel.district.levelTop': 'Nivå {level} (högsta)',
  'sel.district.now': 'Nu: {fx}',
  'sel.district.next': 'Nästa nivå: {fx}',
  'sel.district.maxed': 'Högsta nivån.',
  'sel.district.building': 'Byggs...',
  'sel.district.upgrading': 'Uppgraderas...',
  'sel.district.upgrade': 'Uppgradera ({price})',
  'sel.district.upgradeTip': 'Uppgradera till nivå {level} för {price} guld.',
  'sel.district.remove': 'Riv',
  'sel.district.removeTip': 'Riv distriktet. Ingen ersättning, och du får vänta innan du kan riva igen.',
  'sel.district.removeConfirm': 'Bekräfta',
  'sel.district.removeConfirmTip': 'Klicka igen inom några sekunder för att riva distriktet. Ingen ersättning.',
  'sel.district.whyGold': 'För lite guld.',
  'sel.district.whyCityBuilding': 'Staden byggs fortfarande.',
  'sel.district.whyOccupied': 'Platsen är upptagen.',
  'sel.district.whyEmpty': 'Platsen är tom.',
  'sel.district.whySlot': 'Platsen finns inte i en stad på den här nivån.',
  'sel.district.whyNotCity': 'Det är ingen stad.',
  'sel.district.whyKind': 'Okänt slag av distrikt.',
  'toast.district.cityBuilding': 'Staden byggs fortfarande.',
  'toast.heli.noFactory': 'Det där är ingen fabrik.',
  'toast.heli.notOwner': 'Det är inte din fabrik.',
  'toast.heli.factoryBuilding': 'Fabriken är inte färdig än.',
  'toast.heli.queueBusy': 'Fabriken bygger redan en helikopter.',
  'toast.heli.fleetCap': 'Flottan är full. Fler fabriker och högre nivåer ger plats för fler helikoptrar.',
  'toast.heli.noGold': 'För lite guld för en helikopter.',
  'toast.lz.water': 'Du kan inte landa på vatten.',
  'toast.lz.peak': 'Du kan inte landa på en bergstopp.',
  'toast.lz.terrain': 'Det går inte att landa där (skog, berg eller is).',
  'toast.lz.steep': 'Marken är för brant för en landning.',
  'toast.lz.enemyCity': 'För nära en fiendes stad.',
  'toast.lz.tooHigh': 'Marken ligger för högt för en landning.',
  'toast.lz.outOfFuel': 'För långt bort, bränslet räcker inte.',
  'toast.lz.noRoute': 'Det finns ingen flygrutt dit.',
  'toast.district.occupied': 'Platsen är upptagen.',
  'toast.district.empty': 'Platsen är tom.',
  'toast.district.slot': 'Platsen finns inte i en stad på den här nivån.',
  'toast.district.notCity': 'Det är ingen stad.',
  'toast.district.kind': 'Okänt slag av distrikt.',
  // M18-2: win conditions, pause menu, result screen, elimination
  'win.title': 'Vinstvillkor',
  'win.preset.standard': 'Standard',
  'win.preset.quick': 'Snabb match',
  'win.preset.sandbox': 'Sandlåda',
  'win.land': 'Erövra en andel av världen',
  'win.landPct': 'Andel av världen som ska erövras, i procent',
  'win.pct': '{n} %',
  'win.last': 'Sist kvar',
  'win.score': 'Poäng efter tid',
  'win.minutes': 'Tidsgräns för poängen',
  'win.minutes.auto': 'Standard för området',
  'win.minutes.n': '{n} minuter',
  'win.part.land': 'Erövra {pct} % av världen och håll det i {secs} s',
  'win.part.last': 'Sist kvar',
  'win.part.score': 'Flest poäng efter {min} min',
  'win.summary': 'Vinst: {parts}',
  'win.sandbox': 'Sandlåda: matchen tar aldrig slut.',
  'pause.title': 'Paus',
  'pause.resume': 'Fortsätt',
  'pause.restart': 'Starta om',
  'pause.menu': 'Till menyn',
  'pause.speed': 'Hastighet',
  'result.title.you': 'Seger!',
  'result.title.other': '{name} vann',
  'result.title.none': 'Matchen är slut',
  'result.reason.landYou': 'Ni erövrade {pct} procent av världen i {secs} sekunder',
  'result.reason.land': '{name} erövrade {pct} procent av världen i {secs} sekunder',
  'result.reason.last': 'Sist kvar',
  'result.reason.score': 'Högst poäng efter {min} minuter',
  'result.reason.none': 'Ingen vinnare',
  'result.col.rank': 'Plats',
  'result.col.nation': 'Nation',
  'result.col.land': 'Mark',
  'result.col.score': 'Poäng',
  'result.col.peak': 'Toppmark',
  'result.col.built': 'Byggt',
  'result.col.conquered': 'Erövrat',
  'result.playAgain': 'Spela igen',
  'result.toMenu': 'Till menyn',
  'elim.title': 'Din nation är utslagen',
  'elim.text': 'Du har ingen mark kvar. Du kan titta på resten av matchen, börja om eller gå till menyn.',
  'elim.spectate': 'Titta på',
  'spectator.badge': 'Åskådare',
  'toast.eliminated': '{names} är utslagen',
  'toast.capitalLost': '{names} förlorade huvudstaden',
  'toast.structuresSimplified': 'Många byggnader: de längst bort visas som enkla ikoner',
  // M20a-lite: the hotkey help (`?`), commands and the top bar
  'help.title': 'Genvägar',
  'help.hint': 'Tryck ? eller Esc för att stänga',
  'hotkey.key.space': 'Mellanslag',
  'hotkey.focus': 'Flyg till din huvudstad',
  'hotkey.build': 'Bygg (1 stad, 2 fabrik, 3 hamn ...)',
  'hotkey.escape': 'Avbryt läge, annars pausmenyn',
  'hotkey.pause': 'Paus',
  'hotkey.slower': 'Långsammare',
  'hotkey.faster': 'Snabbare',
  'hotkey.commitDown': 'Skicka mindre trupper',
  'hotkey.commitUp': 'Skicka fler trupper',
  'hotkey.help': 'Visa eller dölj genvägar',
  'hotkey.overlay': 'Prestandaruta',
  'hotkey.devpanel': 'Utvecklarpanelen',
  'toast.cmd.notOwnGround': 'Du kan bara bygga på din egen mark.',
  'hud.win.label': 'Vinst',
  'hud.win.leader': '{pct} av {need} · {name}',
  'hud.win.noLeader': 'Ingen ledare än',
  'hud.win.hold': '{secs} s kvar ({name})',
  'hud.win.aria': 'Ledarens andel av vinstgränsen',
  // M13a-1: helicopters (build button, fleet gauge, toasts)
  'hud.fleet': 'Helikoptrar',
  'sel.heli.build': 'Bygg helikopter ({price})',
  'sel.heli.tip': 'En helikopter kostar {price} guld och tar {seconds} s att bygga.',
  'sel.heli.fleet': 'Helikoptrar {n}/{cap}',
  'sel.heli.queue': 'Bygger helikopter, {s} s kvar',
  'toast.heli.produced': 'En helikopter är klar.',
  'toast.heli.scrapped': 'Helikopterbygget skrotades.',
} as const;

export type TextKey = keyof typeof sv;

const en: Record<TextKey, string> = {
  'app.title': 'Conquer the Earth',
  'app.tagline': 'Pick a starting place on the globe, grow your nation across mountains and plains and take land from tribes and AI nations.',
  'app.loading': 'Loading the world...',
  'app.error': 'Could not start: {message}',

  'start.play': 'Play',
  'start.dev': 'Dev',
  'start.devAria': 'Open the Dev panel (F2)',
  'start.language': 'Svenska',
  'start.languageAria': 'Switch the language to Swedish',
  'start.helpTitle': 'How to play',
  'help.click': 'Click the ground: first to spawn (within 15 seconds, so the AI nations settle near you), then to attack enemy or unowned land',
  'help.drag': 'Drag with the mouse: rotate the globe. Mouse wheel: zoom',
  'help.commit': '[ and ]: commitment in steps of 5 % (- and + work too)',
  'help.speed': 'Space: pause. , and .: slower and faster',
  'help.dev': 'F2: the Dev panel. F3: frame rate',
  'start.gpuChosen': 'The game runs on {name} and chose low graphics to keep the frame rate smooth.',
  'start.gpuBetter': 'Want nicer graphics? Open the Dev panel (F2) and pick Quality: medium, or add #quality-medium at the end of the address.',
  'start.gpuSeparate': 'If the computer has a separate graphics card: Windows Settings, System, Display, Graphics, pick the browser, Options, High performance. Restart the browser.',
  'start.gpuClose': 'Close',
  'start.gpuMore': 'More',
  'start.gpuLess': 'Less',
  'start.gpuCloseAria': 'Close the graphics tip',
  'start.gpuNameFallback': 'your computer',

  'hud.gold': 'Gold',
  'hud.goldRate': '+{rate}/s',
  'hud.troops': 'Troops',
  'hud.cap': 'cap {cap}',
  'hud.nearCap': 'Near the cap',
  'hud.landShare': 'Land share',
  'hud.timer': 'Time',
  'hud.leaderboard': 'Leaderboard',
  'hud.leaderboardEmpty': 'Nobody has spawned yet',
  'hud.you': 'You',
  'hud.nation': 'Nation {n}',
  'hud.tribe': 'Tribe {n}',
  'hud.rank': '{n}.',
  'hud.percent': '{n}%',
  'hud.speedLabel': 'Speed',
  'hud.pause': 'Pause',
  'hud.speedValue': '{n}x',
  'hud.commit': 'Commitment',
  'hud.commitTroops': '{n} troops',
  'hud.commitAria': 'Commitment as a percentage of your troops',

  'phase.spawnPick': 'Choose your starting place: click the ground',
  'phase.spawnDone': 'Starting place chosen. Waiting for the phase to end',
  'phase.spawnMissed': 'You did not choose a starting place in time. Reload the page for a new match.',
  'phase.immunity': 'Protected for a short while. Get ready to attack',
  'phase.play': 'Click enemy or unowned land to attack',
  'phase.seconds': '{s} s',
  'phase.paused': 'Paused',

  'reject.terrain': 'You cannot spawn there (sea, peak or ice).',
  'reject.owned': 'Somebody already owns that land.',
  'reject.spawned': 'You have already spawned.',
  'reject.phase': 'That is not possible in this phase.',
  'reject.immune': 'Protected for the first seconds.',
  'reject.noContact': 'You do not border that land.',
  'reject.noTroops': 'No troops to send.',
  'reject.self': 'That is your own land.',
  'reject.notSpawned': 'Spawn first.',
  'reject.amount': 'Invalid amount.',
  'reject.pct': 'The commitment must be at least 5 %.',
  'reject.other': 'Refused (code {code}).',
  'toast.notConquerable': 'That cannot be conquered (sea, peak or ice).',

  'tooltip.sea': 'Sea',
  'tooltip.unknownCountry': 'Unknown country',
  'class.0': 'Deep sea',
  'class.1': 'Shallow sea',
  'class.2': 'Plains',
  'class.3': 'Forest',
  'class.4': 'Hills',
  'class.5': 'Mountains',
  'class.6': 'Peak',
  'class.7': 'Ice',
  'setup.reason.tooFewCells': 'The country has too few cells for a fair start: {cells} of {need} cells.',
  'setup.reason.smallLandmass': 'The land mass is too small for a fair start: {cells} of {need} cells.',
  'setup.reason.noCapitalLand': 'The capital is not on playable land.',
  'setup.reason.outsideRegion': 'The country lies outside the chosen region.',
  'setup.reason.excluded': 'The country is not selectable in the game.',
  'setup.start.terrain': 'Pick a place on land (plains, forest, hills or mountains).',
  'setup.error.invalid': 'Invalid setting: {field}.',
  'setup.error.neutralNeedsCustom': 'The mode without real borders needs a custom nation.',
  'setup.error.nameTaken': 'The name "{name}" belongs to a real country. Choose a name of your own.',
  'setup.error.notEnoughCountries': 'Only {available} suitable countries exist for {wanted} AI nations in this region.',
  'start.setup': 'Choose country and options',
  'start.playHint': 'Quick start: you click where you want to begin on the globe.',
  'start.setupHint': 'Pick a real country or make up your own, with its own flag.',
  'phase.preplaced': 'All nations are in place. Attacks are allowed when the countdown ends',
  'tooltip.land': 'Land',

  'setup.title': 'New match',
  'setup.back': 'Back',
  'setup.cityStyle': 'City style: {style}',
  'setup.cityStyleOld': 'Old',
  'setup.cityStyleNew': 'New',
  'setup.loading': 'Preparing the world...',
  'setup.tab.real': 'Real country',
  'setup.tab.custom': 'Custom nation',
  'setup.search': 'Search countries',
  'setup.searchPlaceholder': 'Search in Swedish or English...',
  'setup.pickHint': 'Or click a country on the globe.',
  'setup.noMatch': 'No country matches the search.',
  'setup.cells': '{cells} cells',
  'setup.cells.one': '{cells} cell',
  'setup.countryOk': '{name} can be chosen. Your start disc will be {need} cells.',
  'setup.click.sea': 'That is sea. Click a country.',
  'setup.click.unknown': 'That country is not in the list.',
  'setup.nation.name': 'Nation name',
  'setup.nation.defaultName': 'Newland',
  'setup.nation.color': 'Colour',
  'setup.nation.colorOption': 'Colour {n}',
  'setup.nation.flag': 'Flag',
  'setup.nation.reroll': 'New flag',
  'setup.nation.place': 'Starting place',
  'setup.nation.placeHint': 'Click land on the globe to choose where you begin.',
  'setup.nation.placeSet': 'Starting place chosen: {lat}, {lon}.',
  'setup.options': 'Match options',
  'setup.region': 'Area',
  'setup.region.world': 'The whole world',
  'setup.region.europe': 'Europe',
  'setup.region.eastAsia': 'East Asia',
  'setup.region.americas': 'The Americas',
  'setup.region.africaMiddleEast': 'Africa and the Middle East',
  'setup.ai': 'AI nations',
  'setup.aiMax': 'at most {n} here',
  'setup.tribes': 'Tribes',
  'setup.difficulty': 'Difficulty',
  'setup.difficulty.easy': 'Easy',
  'setup.difficulty.normal': 'Normal',
  'setup.difficulty.hard': 'Hard',
  'setup.difficultyNote': 'Stored with the match. The AI starts using it in a later version.',
  'setup.seed': 'Seed',
  'setup.seedHint': 'The same choices and the same seed give the same start.',
  'setup.neutral': 'No real borders',
  'setup.neutralHint': 'No country borders or country names are drawn, the AI nations get invented names. Needs a custom nation.',
  'setup.disclaimer': 'A stylised, fictional map, no political positions.',
  'setup.sources': 'Borders and names follow the de facto lines of Natural Earth; disputed areas have neutral names.',
  'setup.start': 'Start the match',
  'setup.starting': 'Building the world...',
  'setup.need.country': 'Choose a country in the list or on the globe.',
  'setup.need.name': 'Type a name for your nation (at most 24 characters).',
  'setup.need.cell': 'Click land on the globe to choose a starting place.',
  'setup.need.seed': 'The seed must be a whole number.',
  'setup.error.start': 'The match could not be built: {reason}',

  'hud.build.bar': 'Build bar',
  'hud.build.city': 'City',
  'hud.build.cityTip': 'Build a city (key 1). Price: {price} gold.',
  'hud.build.cityCost': '{price}',
  'hud.build.tooPoor': 'Not enough gold: a city costs {price} gold.',
  'hud.build.placing': 'Click your land to place. Shift + click: several. Esc or right click: cancel.',
  'toast.build.notOwned': 'You can only build on your own land.',
  'toast.build.peak': 'You cannot build on a peak.',
  'toast.build.mountain': 'That cannot be built on a mountain.',
  'toast.build.hills': 'A port cannot be built on hills.',
  'toast.build.forest': 'A silo cannot be built in a forest.',
  'toast.build.noCoast': 'A port has to be on the coast.',
  'toast.build.occupied': 'There is already a building there.',
  'toast.build.spacing': 'Too close to another building of the same kind.',
  'toast.build.fallout': 'The ground is contaminated by fallout.',
  'toast.build.noFactory': 'A silo needs a finished factory.',
  'toast.build.gold': 'Not enough gold.',
  'toast.build.phase': 'Wait for the start phase to end before you build.',
  'hud.build.waitPhase': 'Wait for the start phase to end.',
  'sel.why.phase': 'Wait for the start phase to end.',
  'toast.build.full': 'There is no room for more buildings.',
  'hud.build.factory': 'Factory',
  'hud.build.factoryTip': 'Build a factory (key 2). Price: {price} gold.',
  'hud.build.tooPoorFactory': 'Not enough gold: a factory costs {price} gold.',
  'hud.build.port': 'Port',
  'hud.build.portTip': 'Build a port on the coast (key 3). Price: {price} gold.',
  'hud.build.tooPoorPort': 'Not enough gold: a port costs {price} gold.',
  'hud.build.silo': 'Silo',
  'hud.build.siloTip': 'Build a silo (key 4). Needs a finished factory of your own. Price: {price} gold.',
  'hud.build.sam': 'SAM site',
  'hud.build.samTip': 'Build a SAM site (key 5). Can stand on mountains. Price: {price} gold.',
  'hud.build.post': 'Defense post',
  'hud.build.postTip': 'Build a defense post (key 6). Can stand on mountains. Price: {price} gold.',
  'hud.build.tooPoorOf': 'Not enough gold: {name} costs {price} gold.',
  'hud.build.needFactory': '{name} needs a finished factory of your own.',
  'sel.panel': 'Selected building',
  'sel.level': 'Level {level}',
  'sel.levelTop': 'Level {level} (highest)',
  'sel.fxNext': 'Next level: {fx}',
  'sel.owner.you': 'yours',
  'sel.owner.other': "someone else's",
  'sel.state.building': 'Under construction',
  'sel.state.upgrading': 'Upgrading...',
  'sel.fx.city': 'Gives {gold} gold/s and {troops} more troop cap.',
  'sel.fx.factory': 'Gives {gold} gold/s and {pct} % more income from cities within {radius} cells.',
  'sel.fx.port': 'Gives {gold} gold/s and trade with other ports ({pct} % of the trade value).',
  'sel.fx.silo': 'Missile silo: has no function yet, missiles come later.',
  'sel.fx.sam': 'Air defence: range {radius} cells ({pct} % further on mountains).',
  'sel.fx.post': 'Makes enemy conquest {mult} times as expensive within {radius} cells.',
  'sel.upgrade': 'Upgrade ({price})',
  'sel.upgradeMax': 'Top level',
  'sel.upgradeTip': 'Upgrade to level {level} for {price} gold. Takes {seconds} s.',
  'sel.delete': 'Demolish',
  'sel.deleteTip': 'Demolish the building. No refund, and you wait {seconds} s before you can demolish again.',
  'sel.why.notOwner': 'This building is not yours.',
  'sel.why.gold': 'Not enough gold: the upgrade costs {price} gold.',
  'sel.why.maxLevel': 'The building is already at the top level.',
  'sel.why.busy': 'The building is under construction or upgrading.',
  'sel.why.cooldown': 'Demolish is cooling down: {seconds} s left.',
  'sel.why.gone': 'The building no longer exists.',
  'sel.hint': 'Esc or a click on empty ground: deselect.',
  'sel.deleteConfirm': 'Confirm',
  'sel.deleteConfirmTip': 'Click again within a few seconds to demolish the building. No refund.',
  'toast.struct.gone': 'The building no longer exists.',
  'toast.struct.notOwner': 'This building is not yours.',
  'toast.struct.maxLevel': 'The building is already at the top level.',
  'toast.struct.busy': 'The building is under construction or upgrading.',
  'toast.struct.cooldown': 'Demolish is cooling down, try again in a moment.',
  // Districts-2a (city view)
  'sel.city.open': 'Open city',
  'sel.city.openTip': 'Open the city view: build and upgrade districts in the city.',
  'sel.city.close': 'Close',
  'sel.city.panel': 'City view',
  'sel.city.title': 'City, level {level}',
  'sel.city.titleTop': 'City, level {level} (highest)',
  'sel.city.upgrade': 'Upgrade city ({price})',
  'sel.city.upgradeMax': 'Top level',
  'sel.city.upgradeTip': 'Upgrade the city to level {level} for {price} gold. Takes {seconds} s. More gold and more troops.',
  'sel.city.stateBuilding': 'The city is being built...',
  'sel.city.stateUpgrading': 'The city is upgrading...',
  'sel.city.totalsGold': 'Gold: {gold}/s',
  'sel.city.totalsTroops': 'Troop cap: {troops}',
  'sel.city.totalsRegen': 'Regeneration: +{pct} %',
  'sel.city.totalsWalls': 'Walls: x{mult}',
  'sel.city.totalsWallsNone': 'Walls: none',
  'sel.city.hint': 'Esc or Close: back to the map.',
  'sel.city.tile': 'Slot {n}',
  'sel.city.tileEmpty': 'Empty slot. Choose what to build:',
  'sel.city.tileProgress': '{pct} % done',
  'sel.district.housing': 'Housing',
  'sel.district.market': 'Market',
  'sel.district.barracks': 'Barracks',
  'sel.district.walls': 'Walls',
  'sel.district.fxHousing': '+{troops} troop cap',
  'sel.district.fxMarket': '+{gold} gold/s',
  'sel.district.fxBarracks': '+{pct} % troop regeneration',
  'sel.district.fxWalls': 'Enemy conquest x{mult} as expensive on the city cell and {radius} cells around',
  'sel.district.build': '{name} ({price})',
  'sel.district.buildTime': 'Build time {seconds} s',
  'sel.district.buildTip': 'Build {name} for {price} gold. Build time {seconds} s. {fx}',
  'sel.district.level': 'Level {level}',
  'sel.district.levelTop': 'Level {level} (highest)',
  'sel.district.now': 'Now: {fx}',
  'sel.district.next': 'Next level: {fx}',
  'sel.district.maxed': 'Top level.',
  'sel.district.building': 'Building...',
  'sel.district.upgrading': 'Upgrading...',
  'sel.district.upgrade': 'Upgrade ({price})',
  'sel.district.upgradeTip': 'Upgrade to level {level} for {price} gold.',
  'sel.district.remove': 'Demolish',
  'sel.district.removeTip': 'Demolish the district. No refund, and you wait before you can demolish again.',
  'sel.district.removeConfirm': 'Confirm',
  'sel.district.removeConfirmTip': 'Click again within a few seconds to demolish the district. No refund.',
  'sel.district.whyGold': 'Not enough gold.',
  'sel.district.whyCityBuilding': 'The city is still being built.',
  'sel.district.whyOccupied': 'The slot is taken.',
  'sel.district.whyEmpty': 'The slot is empty.',
  'sel.district.whySlot': 'That slot does not exist in a city of this level.',
  'sel.district.whyNotCity': 'That is not a city.',
  'sel.district.whyKind': 'Unknown kind of district.',
  'toast.district.cityBuilding': 'The city is still being built.',
  'toast.heli.noFactory': 'That is not a factory.',
  'toast.heli.notOwner': 'That is not your factory.',
  'toast.heli.factoryBuilding': 'The factory is not finished yet.',
  'toast.heli.queueBusy': 'The factory is already building a helicopter.',
  'toast.heli.fleetCap': 'The fleet is full. More factories and higher levels make room for more helicopters.',
  'toast.heli.noGold': 'Not enough gold for a helicopter.',
  'toast.lz.water': 'You cannot land on water.',
  'toast.lz.peak': 'You cannot land on a peak.',
  'toast.lz.terrain': 'You cannot land there (forest, mountain or ice).',
  'toast.lz.steep': 'The ground is too steep to land on.',
  'toast.lz.enemyCity': 'Too close to an enemy city.',
  'toast.lz.tooHigh': 'The ground is too high to land on.',
  'toast.lz.outOfFuel': 'Too far away, the fuel will not last.',
  'toast.lz.noRoute': 'There is no flight route there.',
  'toast.district.occupied': 'The slot is taken.',
  'toast.district.empty': 'The slot is empty.',
  'toast.district.slot': 'That slot does not exist in a city of this level.',
  'toast.district.notCity': 'That is not a city.',
  'toast.district.kind': 'Unknown kind of district.',
  'win.title': 'Win conditions',
  'win.preset.standard': 'Default',
  'win.preset.quick': 'Quick match',
  'win.preset.sandbox': 'Sandbox',
  'win.land': 'Conquer a share of the world',
  'win.landPct': 'Share of the world to conquer, in percent',
  'win.pct': '{n}%',
  'win.last': 'Last one standing',
  'win.score': 'Points after a time',
  'win.minutes': 'Time limit for the points',
  'win.minutes.auto': 'Default for the area',
  'win.minutes.n': '{n} minutes',
  'win.part.land': 'Conquer {pct}% of the world and hold it for {secs} s',
  'win.part.last': 'Last one standing',
  'win.part.score': 'Most points after {min} min',
  'win.summary': 'Win: {parts}',
  'win.sandbox': 'Sandbox: the match never ends.',
  'pause.title': 'Paused',
  'pause.resume': 'Resume',
  'pause.restart': 'Restart',
  'pause.menu': 'To the menu',
  'pause.speed': 'Speed',
  'result.title.you': 'Victory!',
  'result.title.other': '{name} won',
  'result.title.none': 'The match is over',
  'result.reason.landYou': 'You conquered {pct} percent of the world and held it for {secs} seconds',
  'result.reason.land': '{name} conquered {pct} percent of the world and held it for {secs} seconds',
  'result.reason.last': 'Last one standing',
  'result.reason.score': 'Most points after {min} minutes',
  'result.reason.none': 'No winner',
  'result.col.rank': 'Rank',
  'result.col.nation': 'Country',
  'result.col.land': 'Land',
  'result.col.score': 'Score',
  'result.col.peak': 'Peak land',
  'result.col.built': 'Built',
  'result.col.conquered': 'Conquered',
  'result.playAgain': 'Play again',
  'result.toMenu': 'To the menu',
  'elim.title': 'Your nation is eliminated',
  'elim.text': 'You have no land left. You can watch the rest of the match, start over or go to the menu.',
  'elim.spectate': 'Watch',
  'spectator.badge': 'Spectator',
  'toast.eliminated': '{names} was eliminated',
  'toast.capitalLost': '{names} lost the capital',
  'toast.structuresSimplified': 'Many buildings: the farthest ones are shown as simple icons',
  'help.title': 'Shortcuts',
  'help.hint': 'Press ? or Esc to close',
  'hotkey.key.space': 'Space',
  'hotkey.focus': 'Fly to your capital',
  'hotkey.build': 'Build (1 city, 2 factory, 3 port ...)',
  'hotkey.escape': 'Cancel a mode, otherwise the pause menu',
  'hotkey.pause': 'Pause',
  'hotkey.slower': 'Slower',
  'hotkey.faster': 'Faster',
  'hotkey.commitDown': 'Send fewer troops',
  'hotkey.commitUp': 'Send more troops',
  'hotkey.help': 'Show or hide the shortcuts',
  'hotkey.overlay': 'Performance box',
  'hotkey.devpanel': 'Developer panel',
  'toast.cmd.notOwnGround': 'You can only build on your own land.',
  'hud.win.label': 'Win',
  'hud.win.leader': '{pct} of {need} · {name}',
  'hud.win.noLeader': 'No leader yet',
  'hud.win.hold': '{secs} s left ({name})',
  'hud.win.aria': "The leader's share of the win limit",
  // M13a-1: helicopters (build button, fleet gauge, toasts)
  'hud.fleet': 'Helicopters',
  'sel.heli.build': 'Build helicopter ({price})',
  'sel.heli.tip': 'A helicopter costs {price} gold and takes {seconds} s to build.',
  'sel.heli.fleet': 'Helicopters {n}/{cap}',
  'sel.heli.queue': 'Building a helicopter, {s} s left',
  'toast.heli.produced': 'A helicopter is ready.',
  'toast.heli.scrapped': 'The helicopter under construction was scrapped.',
};

/** The two tables, for the parity test and for tools. Treat as read-only. */
export const TABLES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { sv, en };

export type TextParams = Readonly<Record<string, string | number>>;

let language: Lang = DEFAULT_LANGUAGE;
let version = 0;
let strict = false;
const listeners = new Set<(lang: Lang) => void>();

export function getLanguage(): Lang {
  return language;
}

/** Increases whenever the language changes: cached texts compare it to know they must be rebuilt. */
export function languageVersion(): number {
  return version;
}

export function setLanguage(next: Lang): void {
  if (next === language) return;
  language = next;
  version++;
  for (const l of listeners) l(next);
}

/** Calls `listener` after the language changed; returns the function that stops it. */
export function onLanguageChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `lang=en` (query or hash) selects English; anything else is the default. */
export function languageOf(raw: Readonly<Record<string, string>>): Lang {
  return raw.lang === 'en' ? 'en' : raw.lang === 'sv' ? 'sv' : DEFAULT_LANGUAGE;
}

/** Test mode: a missing key or placeholder value throws instead of falling back. */
export function setStrictI18n(on: boolean): void {
  strict = on;
}

export function isStrictI18n(): boolean {
  return strict;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** The placeholder names of a text, in order of appearance (used by the parity test). */
export function placeholdersOf(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER), (m) => m[1] as string);
}

/**
 * The text of `key` in the current language with `{name}` filled from `params`. A missing key falls back to the other
 * language and then to the key itself; in strict mode (test mode) a key that is missing from EITHER table, or a placeholder
 * without a value, throws.
 */
export function t(key: TextKey, params?: TextParams): string {
  const own = TABLES[language][key];
  const other = TABLES[language === 'sv' ? 'en' : 'sv'][key];
  if (strict && (own === undefined || other === undefined)) {
    throw new Error(`i18n: key "${key}" is missing from the ${own === undefined ? language : language === 'sv' ? 'en' : 'sv'} table`);
  }
  const text = own ?? other ?? key;
  if (params === undefined && !strict) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const v = params?.[name];
    if (v === undefined) {
      if (strict) throw new Error(`i18n: key "${key}" needs the value {${name}}`);
      return whole;
    }
    return String(v);
  });
}

/**
 * A text with a count: `oneKey` when `count` is exactly 1, else `key` (the plural; also used for 0). Both languages here have two forms, so the
 * pair is all a caller needs: `tn('setup.cells', 'setup.cells.one', n, { cells: n })`. The value is passed in `params` like for `t`.
 */
export function tn(key: TextKey, oneKey: TextKey, count: number, params?: TextParams): string {
  return t(count === 1 ? oneKey : key, params);
}

/** True when `key` exists in both tables. */
export function hasKey(key: string): key is TextKey {
  return key in sv && key in en;
}

const GROUP_SEPARATOR: Record<Lang, string> = { sv: ' ', en: ',' };
const DECIMAL_SEPARATOR: Record<Lang, string> = { sv: ',', en: '.' };

/** 1234567 -> "1 234 567" (a no-break space) in Swedish, "1,234,567" in English. Whole numbers only; negative numbers keep the sign. */
export function formatInt(n: number): string {
  const r = Math.round(n);
  const digits = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR[language]);
  return r < 0 ? `-${digits}` : digits;
}

/** `value` with `decimals` decimals and the language's decimal separator; no locale APIs, no float formatting surprises. */
export function formatFixed(value: number, decimals: number): string {
  const scale = decimals === 0 ? 1 : decimals === 1 ? 10 : decimals === 2 ? 100 : 1000;
  const scaled = Math.round(Math.abs(value) * scale);
  const whole = Math.floor(scaled / scale);
  const frac = scaled - whole * scale;
  const sign = value < 0 && scaled > 0 ? '-' : '';
  if (decimals === 0) return `${sign}${formatInt(whole)}`;
  return `${sign}${formatInt(whole)}${DECIMAL_SEPARATOR[language]}${String(frac).padStart(decimals, '0')}`;
}

/** The compact suffixes of a displayed gold amount from 1 000 000 up: million, billion (10^9, "miljard" in Swedish), trillion (10^12). */
const COMPACT_SUFFIX: Record<Lang, readonly [string, string, string]> = {
  sv: ['\u00a0mn', '\u00a0mdr', '\u00a0bn'],
  en: ['M', 'B', 'T'],
};
/** From this displayed amount upward a gold amount is written in the compact form; below it the whole number with thousands separators. */
export const GOLD_COMPACT_FROM = 1_000_000;

/**
 * Integration (Sim-Levels2 + Look-2): the ONE writer of a DISPLAYED gold amount (a whole number already multiplied by GOLD_DISPLAY_FACTOR). Below
 * GOLD_COMPACT_FROM it is the whole number with the language's thousands separator ("25 050"). From a million up it is compact with at most 3
 * significant digits, cut (never rounded up, so 999 999 999 never reads "1000 mn"): Swedish "1,23 mn", "49,9 mdr", English "1.23M", "49.9B".
 */
export function formatShownGold(shown: number): string {
  const r = Math.round(shown);
  if (r < 0) return `-${formatShownGold(-r)}`;
  if (r < GOLD_COMPACT_FROM) return formatInt(r);
  let ix = 0;
  let unit = GOLD_COMPACT_FROM;
  while (ix < 2 && r >= unit * 1000) {
    unit *= 1000;
    ix++;
  }
  const whole = Math.floor(r / unit);
  const decimals = whole >= 100 ? 0 : whole >= 10 ? 1 : 2;
  const scale = 10 ** decimals;
  const step = unit / scale; // an integer: unit is 10^6 or more and decimals is at most 2
  const q = (r - (r % step)) / step;
  const intPart = Math.floor(q / scale);
  const frac = String(q - intPart * scale)
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${formatInt(intPart)}${frac === '' ? '' : DECIMAL_SEPARATOR[language] + frac}${COMPACT_SUFFIX[language][ix]}`;
}

/**
 * Look-2: the ONE way a gold amount (a purse, a price, a cost) is shown: the sim amount times GOLD_DISPLAY_FACTOR, a whole number with the language's
 * thousands separator, compact from a million (`formatShownGold`). Every surface that names gold goes through this and `formatGoldRate`;
 * tests/ui/goldDisplay.test.ts scans the UI sources for the rest.
 */
export function formatGold(simGold: number): string {
  return formatShownGold(simGold * GOLD_DISPLAY_FACTOR);
}

/** The same for gold per second, given in sim milli-gold per second: up to two decimals, trailing zeros dropped ("5", "0,5", "0,25"), so a gentle per-level step stays readable; a million or more per second is compact like a purse. */
export function formatGoldRate(milliPerSec: number): string {
  const hundredths = Math.round((milliPerSec * GOLD_DISPLAY_FACTOR) / 10);
  if (hundredths >= GOLD_COMPACT_FROM * 100) return formatShownGold(Math.floor(hundredths / 100));
  if (hundredths % 100 === 0) return formatInt(hundredths / 100);
  if (hundredths % 10 === 0) return formatFixed(hundredths / 100, 1);
  return formatFixed(hundredths / 100, 2);
}

/** Seconds as "m:ss" (language neutral). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
