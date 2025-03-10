const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const bent = require("bent");
const { convertAssToSrtFromUrltoJimaku } = require("./assToSrtFromUrl.js");

const getKitsuJSON = bent("https://kitsu.io/api/edge/", "GET", "json", {
	Accept: "application/vnd.api+json",
	"Content-Type": "application/vnd.api+json",
});
const getJimakuIDJSONSetup = (apiKey) =>
	bent("https://jimaku.cc/api/", "GET", "json", {
		Authorization: apiKey,
	});
const getOMDbJSONSetup = (apiKey) =>
	bent(`https://www.omdbapi.com/?apikey=${apiKey}&`, "GET", "json");
const manifest = {
	id: "community.jimakusub",
	version: "0.0.3",
	catalogs: [],
	resources: ["subtitles"],
	types: ["movie", "series"],
	name: "jimaku-sub",
	description: "Get Japanese subtitles for anime",
	behaviorHints: {
		configurable: true,
		configurationRequired: true,
	},
	config: [
		{
			key: "jimakuApiKey",
			type: "text",
			title: "Put your Jimaku API key here",
			required: true,
		},
		{
			key: "OMDbApiKey",
			type: "text",
			title: "Put your OMDB api key here",
			required: false,
		},
		{
			key: "userName",
			type: "text",
			title: "Put your Discord User Name here",
			required: false,
		},
	],
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async ({ type, id, config }) => {
	console.log(`Request for subtitles: ${type} ${id}`);
	const jimakuApiKey = config.jimakuApiKey;
	const OMDbApiKey = config.OMDbApiKey;
	const userName = config.userName;
	console.log(`I am ${userName}`);
	const getJimakuIDJSON = getJimakuIDJSONSetup(jimakuApiKey); // Check if the ID starts with "kitsu:"
	const getOMDbJSON = getOMDbJSONSetup(OMDbApiKey);
	let apiTitle;
	let episode;
	let apiId;
	let isAnime;
	let fallbackApiTitle;

	try {
		if (id.startsWith("kitsu:")) {
			episode = type === "series" ? id.split(":")[2] : 0;
			apiId = id.split(":")[1];
			const urlKitsu = `anime/${apiId}`;
			const kitsuData = await getKitsuJSON(urlKitsu);
			if (kitsuData.data.attributes.titles.ja_jp) {
				apiTitle = kitsuData.data.attributes.titles.ja_jp;
				fallbackApiTitle = kitsuData.data.attributes.canonicalTitle;
			} else {
				apiTitle = kitsuData.data.attributes.canonicalTitle;
			}
			isAnime = true;
		} else if (id.startsWith("tt")) {
			episode = type === "series" ? id.split(":")[2] : 0;
			apiId = id.split(":")[0];
			const urlOMDb = `i=${apiId}`;
			const OMDbdata = await getOMDbJSON(urlOMDb);

			apiTitle = OMDbdata.Title;
			if (OMDbdata.Genre.includes("Animation")) {
				isAnime = true;
			} else {
				isAnime = false;
			}
		}
		if (!apiTitle) {
			console.error("Not found any api Title");
			return { subtitles: [] };
		}

		if (isAnime) {
			console.log(`${apiTitle} is an anime`);
		} else {
			console.log(`${apiTitle} is not an anime`);
		}
		console.log(`Fetching api details for ID: ${apiId}`);

		let encodedTitle = encodeURIComponent(apiTitle);
		let urlJimakuID = `entries/search?query=${encodedTitle}`;
		if (!isAnime) {
			urlJimakuID = `${urlJimakuID}&anime=false`;
		}

		console.log(`Fetching Jimaku ID from: ${urlJimakuID}`);
		let jimakuData = await getJimakuIDJSON(urlJimakuID);
		let jimakuID = jimakuData[0]?.id;

		if (!jimakuID) {
			console.error("No Jimaku ID found for the title");
			if (fallbackApiTitle) {
				console.log("Trying with fallbackApiTitle");
				encodedTitle = encodeURIComponent(fallbackApiTitle);
				urlJimakuID = `entries/search?query=${encodedTitle}`;
				console.log(`Fetching Jimaku ID from: ${urlJimakuID}`);
				jimakuData = await getJimakuIDJSON(urlJimakuID);
				jimakuID = jimakuData[0]?.id;
				if (!jimakuID) {
					console.error("No Jimaku ID found for the fallbackApiTitle");
					return { subtitles: [] };
				}
			}
		}

		const urlJimakuFiles =
			episode === 0
				? `entries/${jimakuID}/files`
				: `entries/${jimakuID}/files?episode=${episode}`;
		console.log(`Fetching Jimaku subtitle files from: ${urlJimakuFiles}`);
		const subtitleFiles = await getJimakuIDJSON(urlJimakuFiles);

		if (subtitleFiles.length > 0) {
			const subtitles = subtitleFiles
				.filter((file) => file.name.endsWith(".srt"))
				.map((file) => ({
					id: file.name,
					url: file.url,
					lang: "jpn",
				}));
			if (subtitles.length > 0) {
				console.log("Subtitles fetched:", subtitles);
				return { subtitles };
			}
			if (subtitles.length === 0) {
				const assSubtitles = subtitleFiles
					.filter((file) => file.name.endsWith(".ass"))
					.map(async (file) => ({
						id: file.name,
						url: await convertAssToSrtFromUrltoJimaku(
							file.url,
							jimakuID,
							episode,
						),
						lang: "jpn",
					}));
				if (assSubtitles.length > 0) {
					const assSubtitlesPromisesResolved = await Promise.all(assSubtitles);
					console.log("Subtitles fetched:", assSubtitles);
					return { subtitles: assSubtitlesPromisesResolved };
				}
				console.log("No subtitles");
				return { subtitles: [] };
			}
			console.log("No subtitles");
			return { subtitles: [] };
		}
	} catch (error) {
		console.error("Error handling subtitle request:", error);
		return { subtitles: [] };
	}
	console.log("ID does not start with 'kitsu:', returning empty subtitles");
	return { subtitles: [] };
});

const myInterface = builder.getInterface();

serveHTTP(myInterface, { port: 7005 });
console.log("Stremio add-on is running on http://localhost:7000");
