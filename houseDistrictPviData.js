{
    const fs = require("fs");
    const path = require("path");

    const stateNameToCode = {
        "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar",
        "california": "ca", "colorado": "co", "connecticut": "ct", "delaware": "de",
        "florida": "fl", "georgia": "ga", "hawaii": "hi", "idaho": "id",
        "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks",
        "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md",
        "massachusetts": "ma", "michigan": "mi", "minnesota": "mn", "mississippi": "ms",
        "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv",
        "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
        "north carolina": "nc", "north dakota": "nd", "ohio": "oh", "oklahoma": "ok",
        "oregon": "or", "pennsylvania": "pa", "rhode island": "ri", "south carolina": "sc",
        "south dakota": "sd", "tennessee": "tn", "texas": "tx", "utah": "ut",
        "vermont": "vt", "virginia": "va", "washington": "wa", "west virginia": "wv",
        "wisconsin": "wi", "wyoming": "wy"
    };

    let cache = {
        path: "",
        mtimeMs: -1,
        data: {}
    };

    const normalizeName = (value) => String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const normalizeStateCode = (value) => {
        const text = normalizeName(value);
        if(text.length === 2) return text;
        return stateNameToCode[text] || text;
    };

    const normalizeDistrictNumber = (value) => {
        const match = String(value || "").match(/\d+/);
        return match ? String(Number(match[0])) : "";
    };

    const parseShareLine = (line) => {
        const matches = String(line || "").match(/-?\d+(?:\.\d+)?/g);
        if(!matches || matches.length < 3) return null;
        return {
            demShare: Number(matches[0]),
            repShare: Number(matches[1]),
            indShare: Number(matches[2])
        };
    };

    const parsePlanText = (text) => {
        const data = {};
        const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);

        for(let i = 0; i < lines.length; i++){
            const heading = lines[i].match(/^([A-Za-z ]+?)\s*-\s*(\d+)$/);
            if(!heading) continue;

            const stateCode = normalizeStateCode(heading[1]);
            const districtNum = normalizeDistrictNumber(heading[2]);
            if(!stateCode || !districtNum) continue;

            let shares = null;
            for(let j = i + 1; j < Math.min(lines.length, i + 6); j++){
                shares = parseShareLine(lines[j]);
                if(shares) break;
            }
            if(!shares) continue;

            const rawPvi = shares.demShare - shares.repShare;
            if(!data[stateCode]) data[stateCode] = {};
            data[stateCode][districtNum] = {
                state: stateCode,
                district: Number(districtNum),
                demShare: shares.demShare,
                repShare: shares.repShare,
                indShare: shares.indShare,
                rawPvi,
                pvi: Math.abs(rawPvi),
                party: Math.abs(rawPvi) < 0.5 ? "" : (rawPvi >= 0 ? "D" : "R"),
                officialName: `${heading[1].trim()} - ${Number(districtNum)}`
            };
        }

        return data;
    };

    const getDataPath = () => {
        const candidates = [];
        try {
            if(typeof Executive !== "undefined" && Executive.mods && Executive.mods.getRelativePathPrefix){
                candidates.push(Executive.mods.getRelativePathPrefix() + path.sep + "houseDistrictPviData.txt");
            }
        } catch(err) {}
        try {
            if(typeof __dirname !== "undefined") candidates.push(path.join(__dirname, "houseDistrictPviData.txt"));
        } catch(err) {}
        candidates.push("houseDistrictPviData.txt");
        return candidates.filter(Boolean).find(candidate => {
            try { return fs.existsSync(candidate); } catch(err) { return false; }
        }) || candidates[0];
    };

    const getData = () => {
        const dataPath = getDataPath();
        let stat = null;
        try { stat = fs.statSync(dataPath); } catch(err) { return {}; }
        if(cache.path === dataPath && cache.mtimeMs === stat.mtimeMs) return cache.data;
        let text = "";
        try { text = fs.readFileSync(dataPath, "utf8"); } catch(err) { return {}; }
        cache = {
            path: dataPath,
            mtimeMs: stat.mtimeMs,
            data: parsePlanText(text)
        };
        return cache.data;
    };

    const getHouseDistrictPvi = (stateId, districtNumber) => {
        const stateCode = normalizeStateCode(String(stateId || "").split("__")[0]);
        const districtKey = normalizeDistrictNumber(districtNumber);
        if(!stateCode || !districtKey) return null;
        const stateData = getData()[stateCode];
        return stateData ? (stateData[districtKey] || null) : null;
    };

    module.exports = {
        parsePlanText,
        getHouseDistrictPvi
    };
}
