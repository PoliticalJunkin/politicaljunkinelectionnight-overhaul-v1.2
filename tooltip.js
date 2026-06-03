/* Better Election Maps â€“ better-maps/tooltip.js
   NBC Decision Desk refresh
   Adds: county trend arrows, PVI-based battleground badges, key race indicators. */

{
    const resultProxies = require("./proxies.js");
    const municipalityShiftData = require("./municipalityShiftData.js");
    let municipalityVotingPopulationData = { ma: {}, nh: {} };
    try {
        municipalityVotingPopulationData = require("./municipalityVotingPopulationData.js");
    } catch(err) {}
    let houseDistrictPviData = { getHouseDistrictPvi: () => null };
    try {
        houseDistrictPviData = require("./houseDistrictPviData.js");
    } catch(err) {}
    const { getCandidateColour, stringifyColour } = require("./colours.js");

    const tooltipSettings = {
        locale: "en-US",
        percentDecimals: 2,
        pviBattlegroundThreshold: 5,
        tooCloseThreshold: 1,
        keyRaceThreshold: 8,
        countyTrendThreshold: 5
    };

    const tooltipDiv = document.createElement("div");
    tooltipDiv.setAttribute("style", "display: none;");
    tooltipDiv.setAttribute("id", "better-maps-tooltip");
    tooltipDiv.classList.add("nbc-tooltip-container");

    const tooltipComponents = {};


    const isShiftMunicipalityState = (stateId) => ["ma", "nh"].includes(String(stateId || "").toLowerCase());

    const getShiftMunicipalityId = (pathId) => String(pathId || "")
        .toLowerCase()
        .replace(/-state-path-live$/, "")
        .replace(/-state-path$/, "");

    const normalizeMunicipalityName = (name) => String(name || "")
        .toLowerCase()
        .replace(/\b(town|city|municipality|village|ward|precinct)\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const getMunicipalityVotingData = (stateKey, muniId, meta) => {
        const stateData = municipalityVotingPopulationData[String(stateKey || "").toLowerCase()];
        if(!stateData) return null;
        const candidates = [
            meta && meta.displayName,
            muniId,
            String(muniId || "").replace(/_/g, " ")
        ].map(normalizeMunicipalityName).filter(Boolean);
        const keys = Object.keys(stateData);
        for(let i = 0; i < keys.length; i++){
            const item = stateData[keys[i]];
            const itemNames = [keys[i], item && item.officialName].concat(item && item.aliases ? item.aliases : [])
                .map(normalizeMunicipalityName)
                .filter(Boolean);
            if(candidates.some(candidate => itemNames.indexOf(candidate) !== -1)) return item;
        }
        return null;
    };

    const clampShare = (value) => Math.max(0.02, Math.min(0.98, value));

    const getMunicipalityTurnoutMultiplier = (electionType) => {
        if(electionType === "president") return 1;
        if(electionType === "governor" || electionType === "usSenate") return 0.64;
        return 0.72;
    };

    const getCandidatePartyKey = (cand) => {
        if(!cand) return "";
        if(cand.party === "I") return cand.caucus ? "I" + cand.caucus : "I";
        if(cand.party) return String(cand.party).charAt(0);
        if(cand.caucus) return String(cand.caucus).charAt(0);
        return "";
    };

    const getActualRaceParties = (electionType) => {
        const stateDistrict = resultProxies[electionType] ? resultProxies[electionType][activeMap] : null;
        if(!stateDistrict || !stateDistrict.cands) return [];
        const parties = [];
        stateDistrict.cands.forEach(cand => {
            const party = cand.party === "I" ? "I" : getCandidatePartyKey(cand).charAt(0);
            if(party && parties.indexOf(party) === -1) parties.push(party);
        });
        return parties;
    };

    const findRaceCandidate = (electionType, party) => {
        const stateDistrict = resultProxies[electionType] ? resultProxies[electionType][activeMap] : null;
        if(!stateDistrict || !stateDistrict.cands) return null;
        return stateDistrict.cands.filter(cand => {
            const candParty = cand.party === "I" ? "I" : cand.party;
            return candParty === party;
        })[0] || null;
    };

    const makeSyntheticCandidate = (electionType, party, votes) => {
        const base = findRaceCandidate(electionType, party);
        const fallbackName = party === "D" ? "Democratic Candidate" : (party === "R" ? "Republican Candidate" : "Independent Candidate");
        const cand = base ? Object.assign({}, base) : { name: fallbackName, party, caucus: party };
        cand.party = party;
        cand.caucus = cand.caucus || party;
        cand.votes = votes;
        cand.currentVotes = votes;
        return cand;
    };

    const getCountySwingSource = (electionType, live) => {
        try {
            const stateDistrict = resultProxies[electionType][activeMap];
            if(!stateDistrict || !stateDistrict.counties || stateDistrict.counties.length === 0) return null;

            let demVotes = 0, repVotes = 0, indVotes = 0, totalVotes = 0;
            stateDistrict.counties.forEach(county => {
                if(!county.cands) return;
                county.cands.forEach(cand => {
                    const v = live ? safeNum(cand.currentVotes, safeNum(cand.votes)) : safeNum(cand.votes);
                    const party = cand.party === "I" ? "I" : cand.party;
                    if(party === "D") demVotes += v;
                    else if(party === "R") repVotes += v;
                    else indVotes += v;
                    totalVotes += v;
                });
            });

            if(totalVotes <= 0) return null;
            const demShare = demVotes / totalVotes;
            return {
                demShare,
                swing: demShare - getStateMunicipalityBaseline(activeMap),
                totalVotes,
                reportingRatio: stateDistrict.totalVotes > 0
                    ? Math.max(0, Math.min(1, safeNum(stateDistrict.totalCurrVotes) / safeNum(stateDistrict.totalVotes)))
                    : 1
            };
        } catch(err) {
            return null;
        }
    };

    const getMunicipalityReportingRatio = (muniId, meta, source, live) => {
        if(!live || !source) return 1;
        const statewideRatio = Math.max(0, Math.min(1, safeNum(source.reportingRatio, 1)));
        if(statewideRatio >= 0.999) return 1;

        const hash = String(muniId || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const turnoutWeight = Math.max(0.35, Math.min(2.4, safeNum(meta.turnoutWeight, 1)));
        const voterSize = safeNum(meta._votingPopulation, 0);
        const earlyBias = ((hash % 29) / 28) * 0.34;
        const sizeDelay = voterSize > 0
            ? Math.max(-0.10, Math.min(0.30, (Math.log10(voterSize) - 4.2) * 0.11))
            : Math.max(-0.08, Math.min(0.28, (turnoutWeight - 1) * 0.20));
        const jitter = ((hash % 23) - 11) / 120;
        const threshold = Math.max(0, Math.min(0.42, earlyBias + sizeDelay));
        const spread = 1 - threshold;
        if(statewideRatio <= threshold) return Math.max(0, statewideRatio * 0.18);
        return Math.max(0, Math.min(0.99, ((statewideRatio - threshold) / spread) + jitter));
    };

    const getMunicipalitySyntheticDistrict = (muniId, electionType, live) => {
        const stateKey = String(activeMap || "").toUpperCase();
        const stateData = municipalityShiftData[stateKey];
        const meta = stateData ? stateData[muniId] : null;
        if(!meta) return undefined;
        const votingData = getMunicipalityVotingData(stateKey, muniId, meta);
        const votingPopulation = votingData ? safeNum(votingData.votingPopulation, 0) : 0;
        const metaWithVoting = Object.assign({}, meta, { _votingPopulation: votingPopulation });

        const source = getCountySwingSource(electionType, live);
        const baselineInfo = getMunicipalityBaselineInfo(stateKey, meta, votingData);
        const countySwing = source ? source.demShare - baselineInfo.stateBaseline : 0;

        const demShare = clampShare(baselineInfo.baseline + countySwing);
        const actualParties = getActualRaceParties(electionType);
        const hasDemocrat = actualParties.indexOf("D") !== -1;
        const hasRepublican = actualParties.indexOf("R") !== -1;
        const hasIndependent = actualParties.indexOf("I") !== -1;
        const indShare = hasIndependent && hasRepublican ? 0.025 : 0;
        const repShare = hasRepublican ? clampShare(1 - demShare - indShare) : 0;
        const finalIndShare = hasIndependent ? Math.max(0, 1 - (hasDemocrat ? demShare : 0) - repShare) : 0;

        const turnoutFromVoters = votingPopulation > 0
            ? Math.floor(votingPopulation * getMunicipalityTurnoutMultiplier(electionType) * Math.max(0.74, Math.min(1.08, safeNum(meta.turnoutWeight, 1))))
            : 0;
        const turnout = votingPopulation > 0
            ? Math.max(25, Math.min(votingPopulation, turnoutFromVoters))
            : Math.max(250, Math.floor(4200 * getMunicipalityTurnoutMultiplier(electionType) * (meta.turnoutWeight || 1)));
        const demVotes = hasDemocrat ? Math.floor(turnout * demShare) : 0;
        const repVotes = Math.floor(turnout * repShare);
        const indVotes = Math.floor(turnout * finalIndShare);
        const reportingRatio = getMunicipalityReportingRatio(muniId, metaWithVoting, source, live);
        const currentTurnout = Math.floor(turnout * reportingRatio);
        const demCurrentVotes = Math.floor(demVotes * reportingRatio);
        const repCurrentVotes = Math.floor(repVotes * reportingRatio);
        const indCurrentVotes = Math.max(0, currentTurnout - demCurrentVotes - repCurrentVotes);

        const cands = [];
        if(hasDemocrat) cands.push(makeSyntheticCandidate(electionType, "D", demVotes));
        if(hasRepublican) cands.push(makeSyntheticCandidate(electionType, "R", repVotes));
        if(hasIndependent) cands.push(makeSyntheticCandidate(electionType, "I", indVotes));
        cands.forEach(cand => {
            if(cand.party === "D") cand.currentVotes = demCurrentVotes;
            else if(cand.party === "R") cand.currentVotes = repCurrentVotes;
            else cand.currentVotes = indCurrentVotes;
        });

        return {
            name: meta.displayName || muniId,
            totalVotes: turnout,
            totalCurrVotes: currentTurnout,
            pW: !live || reportingRatio >= 0.999,
            votingPopulation: votingPopulation || undefined,
            _votingPopulationMeta: votingData || undefined,
            _countyView: true,
            _municipalityView: true,
            partisanLean: (demShare - repShare) * 100,
            cands
        };
    };


    const safeNum = (value, fallback = 0) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };

    const municipalityBaselineCache = {};

    const getStateMunicipalityBaseline = (stateKey) => {
        const key = String(stateKey || "").toLowerCase();
        if(municipalityBaselineCache[key]) return municipalityBaselineCache[key];

        const shiftState = municipalityShiftData[String(stateKey || "").toUpperCase()] || {};
        const voteState = municipalityVotingPopulationData[key] || {};
        const shiftKeys = Object.keys(shiftState);
        let weightedBaseline = 0;
        let totalWeight = 0;
        shiftKeys.forEach(shiftKey => {
            const meta = shiftState[shiftKey];
            const votingData = getMunicipalityVotingData(stateKey, shiftKey, meta);
            const weight = safeNum(votingData && (votingData.totalRegisteredVoters || votingData.votingPopulation), safeNum(meta && meta.turnoutWeight, 1));
            if(meta && Number.isFinite(Number(meta.demBaseline)) && weight > 0){
                weightedBaseline += Number(meta.demBaseline) * weight;
                totalWeight += weight;
            }
        });

        let dem = 0, rep = 0, total = 0;
        Object.keys(voteState).forEach(name => {
            const item = voteState[name];
            dem += safeNum(item && item.registeredDemocrat);
            rep += safeNum(item && item.registeredRepublican);
            total += safeNum(item && (item.totalRegisteredVoters || item.votingPopulation));
        });

        const registrationLean = total > 0 ? (dem - rep) / total : 0;
        const registrationBaseline = clampShare(0.5 + (registrationLean * 0.45));
        const shiftBaseline = totalWeight > 0 ? clampShare(weightedBaseline / totalWeight) : registrationBaseline;
        const baseline = (dem > 0 || rep > 0) ? registrationBaseline : shiftBaseline;

        municipalityBaselineCache[key] = baseline;
        return baseline;
    };

    const getMunicipalityBaselineInfo = (stateKey, meta, votingData) => {
        const stateBaseline = getStateMunicipalityBaseline(stateKey);
        const total = safeNum(votingData && (votingData.totalRegisteredVoters || votingData.votingPopulation));
        const dem = safeNum(votingData && votingData.registeredDemocrat);
        const rep = safeNum(votingData && votingData.registeredRepublican);

        if(total > 0 && (dem > 0 || rep > 0)){
            const stateData = municipalityVotingPopulationData[String(stateKey || "").toLowerCase()] || {};
            let stateDem = 0, stateRep = 0, stateTotal = 0;
            Object.keys(stateData).forEach(name => {
                const item = stateData[name];
                stateDem += safeNum(item && item.registeredDemocrat);
                stateRep += safeNum(item && item.registeredRepublican);
                stateTotal += safeNum(item && (item.totalRegisteredVoters || item.votingPopulation));
            });

            const localLean = (dem - rep) / total;
            const stateLean = stateTotal > 0 ? (stateDem - stateRep) / stateTotal : 0;
            return {
                baseline: clampShare(stateBaseline + ((localLean - stateLean) * 0.90)),
                stateBaseline
            };
        }

        return {
            baseline: clampShare(safeNum(meta && meta.demBaseline, stateBaseline)),
            stateBaseline
        };
    };

    const formatNumber = (num) => Math.round(safeNum(num)).toLocaleString(tooltipSettings.locale);

    const formatPercent = (num) => safeNum(num).toLocaleString(tooltipSettings.locale, {
        minimumFractionDigits: tooltipSettings.percentDecimals,
        maximumFractionDigits: tooltipSettings.percentDecimals
    });

    const ordinal = (num) => {
        const n = Number(num);
        if(!Number.isFinite(n)) return "";
        const mod100 = n % 100;
        if(mod100 >= 11 && mod100 <= 13) return `${n}th`;
        switch(n % 10){
            case 1: return `${n}st`;
            case 2: return `${n}nd`;
            case 3: return `${n}rd`;
            default: return `${n}th`;
        }
    };

    const getStateObj = (districtId) => {
        try {
            const stateId = String(districtId || "").toLowerCase().split("__")[0];
            return Executive.data.states[stateId];
        }
        catch(err) { return null; }
    };

    const stateNameByCode = {
        al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California",
        co: "Colorado", ct: "Connecticut", de: "Delaware", dc: "Washington D.C.",
        fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois",
        in: "Indiana", ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana",
        me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
        ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada",
        nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York",
        nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon",
        pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota",
        tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia",
        wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming"
    };

    const sameDistrictName = (value, districtId, stateObj) => {
        if(value === undefined || value === null) return false;
        const normalized = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
        const stateName = stateObj && stateObj.name ? String(stateObj.name).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        const rawStateCode = String(districtId || "").toLowerCase().split("__")[0];
        const fallbackName = stateNameByCode[rawStateCode] ? stateNameByCode[rawStateCode].toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        const stateCode = rawStateCode.replace(/[^a-z0-9]/g, "");
        return normalized === stateName || normalized === fallbackName || normalized === stateCode;
    };


    const getSubdivisionLabel = (districtId) => {
        const id = String(districtId || activeMap || "").toLowerCase();
        if(id === "la") return "Parish";
        if(id === "ma" || id === "nh") return "Municipality";
        return "County";
    };

    const getPviInfo = (districtId) => {
        const state = getStateObj(districtId);
        if(!state) return { value: null, label: "PVI N/A", party: "" };

        const directRaw = firstFinite(
            parsePviValue(state.pvi),
            parsePviValue(state.PVI),
            parsePviValue(state.partisanLean),
            parsePviValue(state.partisan_lean),
            parsePviValue(state.lean),
            parsePviValue(state.partisanIndex),
            getPviRawFromObject(state)
        );
        const dem = normalizeShare(firstFinite(state.demPop, state.dem, state.demShare, state.democraticShare, state.democratShare, state.democraticPop, state.democratPop, state.demPct, state.demPercent, state.D));
        const rep = normalizeShare(firstFinite(state.repPop, state.rep, state.repShare, state.republicanShare, state.republicanPop, state.repPct, state.repPercent, state.R));
        const diff = directRaw !== null ? (Math.abs(directRaw) <= 1 ? directRaw * 100 : directRaw) : (dem !== null && rep !== null ? dem - rep : null);
        if(!Number.isFinite(diff)) return { value: null, label: "PVI N/A", party: "", raw: null };
        const abs = Math.abs(diff);
        if(abs < 0.5) return { value: null, label: "PVI N/A", party: "", raw: null };
        const party = diff >= 0.5 ? "D" : "R";

        const label = `PVI ${party}+${formatPercent(abs)}`;
        return { value: abs, label, party, raw: diff };
    };

    const getStateRegistrationGap = (districtId) => {
        const state = getStateObj(districtId);
        if(!state) return null;
        const dem = normalizeShare(firstFinite(
            state.demPop,
            state.dem,
            state.demShare,
            state.democraticShare,
            state.democratShare,
            state.democraticPop,
            state.democratPop,
            state.demPct,
            state.demPercent,
            state.D
        ));
        const rep = normalizeShare(firstFinite(
            state.repPop,
            state.rep,
            state.repShare,
            state.republicanShare,
            state.republicanPop,
            state.repPct,
            state.repPercent,
            state.R
        ));
        return (dem !== null && rep !== null) ? Math.abs(dem - rep) : null;
    };

    const formatPviInfo = (rawValue) => {
        if(rawValue === undefined || rawValue === null || rawValue === "") {
            return { value: null, label: "PVI N/A", party: "", raw: null };
        }
        const raw = safeNum(rawValue);
        if(!Number.isFinite(raw)) return { value: null, label: "PVI N/A", party: "", raw: null };
        const abs = Math.abs(raw);
        if(abs < 0.5) return { value: null, label: "PVI N/A", party: "", raw: null };
        const party = raw >= 0.5 ? "D" : "R";
        return {
            value: abs,
            label: `PVI ${party}+${formatPercent(abs)}`,
            party,
            raw
        };
    };

    const getCandidateLiveVotes = (cand) => {
        if(!cand) return undefined;
        const possible = [cand.currentVotes, cand.currVotes, cand.currentVote, cand.liveVotes, cand.reportingVotes];
        for(let i = 0; i < possible.length; i++){
            if(possible[i] !== undefined && possible[i] !== null) return possible[i];
        }
        return undefined;
    };

    const candidateVotes = (cand, live) => safeNum(
        live ? (getCandidateLiveVotes(cand) ?? cand.votes ?? cand.totVotes ?? cand.totalVotes) : (cand.votes ?? cand.totVotes ?? cand.totalVotes),
        safeNum(cand && (cand.votes ?? cand.totVotes ?? cand.totalVotes))
    );
    const districtVotes = (district, live) => safeNum(live ? district.totalCurrVotes : district.totalVotes, safeNum(district.totalVotes));

    const getHouseStateElectData = (district) => {
        if(typeof allStElectData === "undefined" || !district) return null;
        const stateId = String(district.state || district.stateId || district._betterMapsStateId || "").toLowerCase();
        return allStElectData.filter(electData => String(electData.id || "").toLowerCase() === stateId)[0] || null;
    };

    const hasHouseStateVoteDump = (district, live) => {
        if(!live) return true;
        const stateElectData = getHouseStateElectData(district);
        if(!stateElectData) return false;
        const explicit = [
            stateElectData.started,
            stateElectData.counting,
            stateElectData.hasResults,
            stateElectData.hasReported,
            stateElectData.reportingStarted
        ];
        if(explicit.some(value => value === true || value === 1 || String(value).toLowerCase() === "true")) return true;
        if(safeNum(stateElectData.totalCurrVotes) > 0 || safeNum(stateElectData.currentVotes) > 0) return true;
        if(Array.isArray(stateElectData.counties) && stateElectData.counties.some(county => safeNum(county.indx, -1) > 0 || safeNum(county.totalCurrVotes) > 0 || safeNum(county.currentVotes) > 0)) return true;
        return safeNum(stateElectData.indx, -1) > 0;
    };

    const hasHouseTooltipVoteDump = (district, districtId, live) => {
        if(!live || !district) return true;
        const stateId = String((district && (district.state || district.stateId || district._betterMapsStateId)) || districtId || "").toLowerCase().split("__")[0];
        if(Array.isArray(district.districts)){
            return district.districts.some(childDistrict => {
                if(childDistrict && !childDistrict._betterMapsStateId) childDistrict._betterMapsStateId = stateId;
                return hasHouseStateVoteDump(childDistrict, live);
            });
        }
        if(!district._betterMapsStateId) district._betterMapsStateId = stateId;
        return hasHouseStateVoteDump(district, live);
    };

    const getHousePrimaryBlockCandidates = (block) => {
        if(!block) return [];
        if(Array.isArray(block.cands)) return block.cands;
        if(Array.isArray(block.candidates)) return block.candidates;
        return [];
    };

    const hydrateHouseCandidateLiveVotes = (cand, district, live, stateElectData) => {
        const finalVotes = safeNum(cand && (cand.votes ?? cand.totVotes ?? cand.totalVotes));
        if(!cand) return { finalVotes: 0, currentVotes: 0 };
        if(cand.votes === undefined && cand.totVotes !== undefined) cand.votes = cand.totVotes;
        if(live && hasHouseStateVoteDump(district, live) && stateElectData && cand.updates && cand.updates[stateElectData.indx] !== undefined){
            cand.currentVotes = Math.round(finalVotes * safeNum(cand.updates[stateElectData.indx], 0));
        } else if(!live) {
            cand.currentVotes = finalVotes;
        } else {
            cand.currentVotes = 0;
        }
        return { finalVotes, currentVotes: safeNum(cand.currentVotes) };
    };

    const hydrateHouseDistrictLiveVotes = (district, live) => {
        if(!district) return district;
        district._betterMapsHouseDistrict = true;
        const stateElectData = getHouseStateElectData(district);
        let totalCurrVotes = 0;
        let totalVotes = 0;

        const hydrateList = (cands) => {
            cands.forEach(cand => {
                const hydrated = hydrateHouseCandidateLiveVotes(cand, district, live, stateElectData);
                totalVotes += hydrated.finalVotes;
                totalCurrVotes += hydrated.currentVotes;
            });
        };

        if(Array.isArray(district.cands)) hydrateList(district.cands);
        if(district.dem) hydrateList(getHousePrimaryBlockCandidates(district.dem));
        if(district.rep) hydrateList(getHousePrimaryBlockCandidates(district.rep));
        if(district.ind) hydrateList(getHousePrimaryBlockCandidates(district.ind));
        if(district.nonpartisan) hydrateList(getHousePrimaryBlockCandidates(district.nonpartisan));

        if(Array.isArray(district.candidates) && !Array.isArray(district.cands)){
            hydrateList(district.candidates);
        }

        Object.keys(district || {}).forEach(key => {
            if(["cands", "candidates", "dem", "rep", "ind", "nonpartisan"].indexOf(key) !== -1) return;
            const value = district[key];
            if(value && typeof value === "object") hydrateList(getHousePrimaryBlockCandidates(value));
        });

        district.totalVotes = safeNum(district.totalVotes, totalVotes);
        district.totalCurrVotes = totalCurrVotes;
        return district;
    };

    const sortedCandidates = (district, live) => {
        const cands = district && (district.cands || district.candidates || district.Candidates);
        if(!district || !Array.isArray(cands)) return [];
        return cands.slice().sort((a, b) => candidateVotes(b, live) - candidateVotes(a, live));
    };

    const getRaceStats = (district, live) => {
        const cands = sortedCandidates(district, live);
        const total = districtVotes(district, live);
        const leader = cands[0] || null;
        const runnerUp = cands[1] || null;
        const leaderVotes = leader ? candidateVotes(leader, live) : 0;
        const runnerVotes = runnerUp ? candidateVotes(runnerUp, live) : 0;
        const marginVotes = leaderVotes - runnerVotes;
        const marginPct = total > 0 ? (marginVotes / total) * 100 : 0;
        const leaderShare = total > 0 ? (leaderVotes / total) * 100 : 0;
        return { cands, total, leader, runnerUp, leaderVotes, runnerVotes, marginVotes, marginPct, leaderShare };
    };

    const getPartyKey = (cand) => {
        if(!cand) return "";
        if(cand.party === "I") return "I" + (cand.caucus || "");
        if(cand.party) return String(cand.party).charAt(0);
        if(cand.caucus) return String(cand.caucus).charAt(0);
        return "";
    };

    const normalizePartyKey = (value) => {
        const text = String(value || "").trim().toLowerCase();
        if(!text) return "";
        if(text === "d" || text === "dem" || text.indexOf("democrat") !== -1 || text === "blue") return "D";
        if(text === "r" || text === "rep" || text.indexOf("republican") !== -1 || text.indexOf("gop") !== -1 || text === "red") return "R";
        if(text === "i" || text === "ind" || text.indexOf("independent") !== -1 || text.indexOf("nonpartisan") !== -1) return "I";
        const first = text.charAt(0).toUpperCase();
        return (first === "D" || first === "R" || first === "I") ? first : "";
    };

    const getObjectPartyKey = (obj) => {
        if(!obj) return "";
        if(typeof obj !== "object") return normalizePartyKey(obj);
        return normalizePartyKey(
            obj.party
            || obj.partyId
            || obj.partyID
            || obj.partyName
            || obj.affiliation
            || obj.caucus
            || obj.caucusParty
            || (obj.extendedAttribs && obj.extendedAttribs.party)
            || (obj.extendedAttribs && obj.extendedAttribs.caucusParty)
        );
    };

    const getFlippedCandidatePartyKey = (cand) => {
        return normalizePartyKey(getPartyKey(cand)) || getObjectPartyKey(cand);
    };

    const scanPreviousParty = (obj, depth = 0, seen = [], allowRaceObject = false) => {
        if(!obj || typeof obj !== "object" || depth > 5 || seen.indexOf(obj) !== -1) return "";
        seen.push(obj);

        if(allowRaceObject && sortedCandidates(obj, false).length > 0){
            const stats = getRaceStats(obj, false);
            const party = getFlippedCandidatePartyKey(stats.leader);
            if(party) return party;
        }

        const directKeys = [
            "winnerParty", "winningParty", "winnerCaucusParty", "winningCaucusParty",
            "previousParty", "prevParty", "priorParty", "lastParty",
            "previousWinnerParty", "prevWinnerParty", "priorWinnerParty", "lastWinnerParty",
            "previousWinningParty", "prevWinningParty", "priorWinningParty", "lastWinningParty",
            "previousPresidentialParty", "previousPresidentParty", "lastPresidentialParty",
            "previousGovernorParty", "previousSenateParty", "incumbentParty", "incumbentCaucusParty"
        ];
        for(let i = 0; i < directKeys.length; i++){
            if(Object.prototype.hasOwnProperty.call(obj, directKeys[i])){
                const party = normalizePartyKey(obj[directKeys[i]]);
                if(party) return party;
            }
        }

        const objectKeys = [
            "previousWinner", "prevWinner", "priorWinner", "lastWinner",
            "previousIncumbent", "prevIncumbent", "incumbent",
            "previousElection", "prevElection", "priorElection", "lastElection"
        ];
        for(let i = 0; i < objectKeys.length; i++){
            if(!Object.prototype.hasOwnProperty.call(obj, objectKeys[i])) continue;
            const party = getObjectPartyKey(obj[objectKeys[i]]) || scanPreviousParty(obj[objectKeys[i]], depth + 1, seen, true);
            if(party) return party;
        }

        const keys = Object.keys(obj);
        for(let i = 0; i < keys.length; i++){
            const keyText = keys[i].toLowerCase();
            if(keyText.indexOf("previous") === -1 && keyText.indexOf("prev") === -1
                && keyText.indexOf("prior") === -1 && keyText.indexOf("last") === -1
                && keyText.indexOf("incumb") === -1) continue;
            const value = obj[keys[i]];
            const party = getObjectPartyKey(value) || scanPreviousParty(value, depth + 1, seen, true);
            if(party) return party;
        }

        return "";
    };

    const getGlobalArchiveCandidate = (name) => {
        try {
            if(typeof globalThis !== "undefined" && globalThis[name]) return globalThis[name];
        } catch(err) {}
        try {
            if(typeof window !== "undefined" && window[name]) return window[name];
        } catch(err) {}
        try {
            if(typeof Executive !== "undefined" && Executive.data && Executive.data[name]) return Executive.data[name];
        } catch(err) {}
        try {
            if(typeof Executive !== "undefined" && Executive.data && Executive.data.elections && Executive.data.elections[name]) return Executive.data.elections[name];
        } catch(err) {}
        try {
            if(typeof Executive !== "undefined" && Executive.data && Executive.data.archive && Executive.data.archive[name]) return Executive.data.archive[name];
        } catch(err) {}
        return null;
    };

    const getArchiveElectionList = (archiveElection) => {
        if(!archiveElection) return [];
        if(archiveElection.exitPoll && Array.isArray(archiveElection.exitPoll.states)) return archiveElection.exitPoll.states;
        if(archiveElection.exitPoll && Array.isArray(archiveElection.exitPoll.elections)) return archiveElection.exitPoll.elections;
        if(archiveElection.exitPoll && Array.isArray(archiveElection.exitPoll.results)) return archiveElection.exitPoll.results;
        if(Array.isArray(archiveElection.elections)) return archiveElection.elections;
        if(Array.isArray(archiveElection.results)) return archiveElection.results;
        if(Array.isArray(archiveElection.stateResults)) return archiveElection.stateResults;
        if(Array.isArray(archiveElection.districtResults)) return archiveElection.districtResults;
        if(Array.isArray(archiveElection.stateElections)) return archiveElection.stateElections;
        if(Array.isArray(archiveElection.raceResults)) return archiveElection.raceResults;
        if(Array.isArray(archiveElection.states)) return archiveElection.states;
        if(Array.isArray(archiveElection.districts)) return archiveElection.districts;
        return [];
    };

    const archiveNameMatchesType = (name, electionType) => {
        const text = String(name || "").toLowerCase();
        if(electionType === "president") return text.indexOf("pres") !== -1 || text.indexOf("president") !== -1;
        if(electionType === "usSenate") return text.indexOf("senate") !== -1;
        return text.indexOf("gov") !== -1 || text.indexOf("gubernatorial") !== -1;
    };

    const archiveEntryMatchesType = (entry, sourceName, electionType) => {
        if(archiveNameMatchesType(sourceName, electionType)) return true;
        const text = String(`${entry && entry.office || ""} ${entry && entry.category || ""} ${entry && entry.type || ""} ${entry && entry.electionType || ""} ${entry && entry.name || ""} ${entry && entry.title || ""}`).toLowerCase();
        if(electionType === "president") return text.indexOf("president") !== -1 || text.indexOf("presidential") !== -1;
        if(electionType === "usSenate") return text.indexOf("senate") !== -1;
        return text.indexOf("governor") !== -1 || text.indexOf("gubernatorial") !== -1;
    };

    const extractArchiveEntries = (value, sourceName, depth = 0) => {
        if(!value || depth > 3) return [];
        if(Array.isArray(value)) return value.slice();
        if(typeof value !== "object") return [];
        if(getArchiveElectionList(value).length > 0) return [value];
        const entries = [];
        const keys = Object.keys(value);
        for(let i = 0; i < keys.length; i++){
            const childEntries = extractArchiveEntries(value[keys[i]], keys[i] || sourceName, depth + 1);
            for(let j = 0; j < childEntries.length; j++) entries.push(childEntries[j]);
        }
        return entries;
    };

    const isGeneralArchiveElection = (item) => {
        const text = String(`${item && item.category || ""} ${item && item.type || ""} ${item && item.electionType || ""} ${item && item.name || ""}`).toLowerCase();
        return text.indexOf("primary") === -1 && text.indexOf("general") !== -1;
    };

    const getCurrentElectionYear = () => {
        try {
            if(typeof currentYear !== "undefined") return safeNum(currentYear);
        } catch(err) {}
        try {
            if(typeof globalThis !== "undefined" && globalThis.currentYear !== undefined) return safeNum(globalThis.currentYear);
        } catch(err) {}
        try {
            if(typeof window !== "undefined" && window.currentYear !== undefined) return safeNum(window.currentYear);
        } catch(err) {}
        try {
            if(typeof Executive !== "undefined" && Executive.data && Executive.data.currentYear !== undefined) return safeNum(Executive.data.currentYear);
        } catch(err) {}
        return 0;
    };

    const getArchiveElectionForType = (electionType) => {
        const names = electionType === "president"
            ? ["presidentialArchive", "presidentArchive", "presArchive", "presidentElectionArchive", "presidentialElectionArchive", "archivedPresidentialElections", "presidentialElectionHistory", "presidentElectionHistory", "presElectionHistory", "presidentialHistory", "presidentHistory", "electionArchive", "electionsArchive", "archivedElections", "electionHistory", "electionsHistory", "pastElections", "previousElections", "history"]
            : (electionType === "usSenate"
                ? ["usSenateArchive", "senateArchive", "usSenateElectionArchive", "senateElectionHistory", "electionArchive", "electionsArchive", "archivedElections", "electionHistory", "electionsHistory", "pastElections", "previousElections", "history"]
                : ["allGovArchive", "governorArchive", "govArchive", "governorElectionArchive", "governorElectionHistory", "gubernatorialElectionHistory", "electionArchive", "electionsArchive", "archivedElections", "electionHistory", "electionsHistory", "pastElections", "previousElections", "history"]);
        const currentYearValue = getCurrentElectionYear();
        for(let i = 0; i < names.length; i++){
            const value = getGlobalArchiveCandidate(names[i]);
            const entries = extractArchiveEntries(value, names[i]);
            const archiveEntries = entries.filter(entry => archiveEntryMatchesType(entry, names[i], electionType));
            const selectedEntries = archiveEntries.length > 0 ? archiveEntries : (archiveNameMatchesType(names[i], electionType) ? entries : []);
            if(selectedEntries.length === 0) continue;
            const withLists = selectedEntries
                .filter(item => getArchiveElectionList(item).length > 0)
                .filter(item => electionType !== "president" || currentYearValue <= 0 || safeNum(item.year, safeNum(item.date)) < currentYearValue)
                .sort((a, b) => safeNum(b.year, safeNum(b.date)) - safeNum(a.year, safeNum(a.date)));
            const latest = withLists.filter(isGeneralArchiveElection)[0] || withLists[0] || null;
            if(latest) return latest;
        }
        return null;
    };

    const getArchivedPresidentialStateWinnerParty = (stateResult) => {
        const cands = sortedCandidates(stateResult, false);
        if(cands.length > 0){
            const winner = cands.slice().sort((a, b) => {
                const bEv = safeNum(b.delegates ?? b.electoralVotes ?? b.electVotes ?? b.ev ?? b.evs);
                const aEv = safeNum(a.delegates ?? a.electoralVotes ?? a.electVotes ?? a.ev ?? a.evs);
                if(bEv !== aEv) return bEv - aEv;
                return candidateVotes(b, false) - candidateVotes(a, false);
            })[0];
            const party = getFlippedCandidatePartyKey(winner);
            if(party) return party;
        }
        return scanPreviousParty(stateResult, 0, [], true);
    };

    const getArchivedStateWinnerParty = (stateResult) => {
        const cands = sortedCandidates(stateResult, false);
        if(cands.length > 0){
            const winner = cands.slice().sort((a, b) => candidateVotes(b, false) - candidateVotes(a, false))[0];
            const party = getFlippedCandidatePartyKey(winner);
            if(party) return party;
        }
        return scanPreviousParty(stateResult, 0, [], true);
    };

    const getPreviousPresidentialWinnerParty = (districtId) => {
        const archiveInfo = getArchiveElectionForType("president");
        if(!archiveInfo) return "";
        const stateObj = getStateObj(districtId);
        const states = getArchiveElectionList(archiveInfo);
        const previousState = states.filter(item => sameDistrictName(item.name, districtId, stateObj)
            || sameDistrictName(item.state, districtId, stateObj)
            || sameDistrictName(item.stateName, districtId, stateObj)
            || sameDistrictName(item.district, districtId, stateObj)
            || sameDistrictName(item.id, districtId, stateObj)
            || sameDistrictName(item.stateId, districtId, stateObj))[0];
        return getArchivedPresidentialStateWinnerParty(previousState);
    };

    const getPreviousGovernorWinnerParty = (districtId) => {
        const names = ["allGovArchive", "governorArchive", "govArchive", "governorElectionArchive", "governorElectionHistory", "gubernatorialElectionHistory"];
        const currentYearValue = getCurrentElectionYear();
        const stateObj = getStateObj(districtId);
        const entries = [];
        for(let i = 0; i < names.length; i++){
            const value = getGlobalArchiveCandidate(names[i]);
            const archiveEntries = extractArchiveEntries(value, names[i]).filter(entry => archiveEntryMatchesType(entry, names[i], "governor") && isGeneralArchiveElection(entry));
            for(let j = 0; j < archiveEntries.length; j++) entries.push(archiveEntries[j]);
        }
        const sortedEntries = entries
            .filter(item => currentYearValue <= 0 || safeNum(item.year, safeNum(item.date)) < currentYearValue)
            .sort((a, b) => safeNum(b.year, safeNum(b.date)) - safeNum(a.year, safeNum(a.date)));
        for(let i = 0; i < sortedEntries.length; i++){
            const directMatch = sameDistrictName(sortedEntries[i].state, districtId, stateObj)
                || sameDistrictName(sortedEntries[i].stateName, districtId, stateObj)
                || sameDistrictName(sortedEntries[i].name, districtId, stateObj)
                || sameDistrictName(sortedEntries[i].district, districtId, stateObj)
                || sameDistrictName(sortedEntries[i].id, districtId, stateObj)
                || sameDistrictName(sortedEntries[i].stateId, districtId, stateObj);
            if(directMatch){
                const party = getArchivedStateWinnerParty(sortedEntries[i]);
                if(party) return party;
            }
            const races = getArchiveElectionList(sortedEntries[i]);
            const previousState = races.filter(item => sameDistrictName(item.state, districtId, stateObj)
                || sameDistrictName(item.stateName, districtId, stateObj)
                || sameDistrictName(item.name, districtId, stateObj)
                || sameDistrictName(item.district, districtId, stateObj)
                || sameDistrictName(item.id, districtId, stateObj)
                || sameDistrictName(item.stateId, districtId, stateObj))[0];
            const party = getArchivedStateWinnerParty(previousState);
            if(party) return party;
        }
        return "";
    };

    const isFlippedSeat = (electionType, districtId, district, live, countyView) => {
        const districtCands = sortedCandidates(district, live);
        if(countyView || !district || districtCands.length === 0) return false;
        const projected = district.pW === true
            || district.projected === true
            || district.final === true
            || !live
            || districtCands.some(candidateHasWinFlag);
        const currentStats = getRaceStats(district, live);
        if(!projected && electionType !== "president") return false;
        if(!projected && electionType === "president" && (!currentStats.leader || currentStats.leaderVotes <= 0)) return false;
        if(!currentStats.leader) return false;
        const currentWinner = districtCands.filter(candidateHasWinFlag)[0] || currentStats.leader;

        if(electionType === "usHouse"){
            const incumbent = districtCands.filter(cand => cand.incumbent === true)[0];
            return incumbent ? getFlippedCandidatePartyKey(incumbent) !== getFlippedCandidatePartyKey(currentWinner) : false;
        }

        const stateObj = getStateObj(districtId);
        let previousParty = "";

        if(electionType !== "president"){
            const incumbent = districtCands.filter(cand => cand.incumbent === true)[0];
            previousParty = getFlippedCandidatePartyKey(incumbent);
        } else {
            previousParty = getPreviousPresidentialWinnerParty(districtId);
        }
        if(electionType === "governor") previousParty = getPreviousGovernorWinnerParty(districtId) || previousParty;

        const archiveInfo = getArchiveElectionForType(electionType);
        if(!previousParty && archiveInfo){
            const archivedElections = getArchiveElectionList(archiveInfo);
            const oldDistrict = archivedElections.filter(item => (stateObj && item.district === stateObj.name)
                || sameDistrictName(item.district, districtId, stateObj)
                || sameDistrictName(item.state, districtId, stateObj)
                || sameDistrictName(item.stateName, districtId, stateObj)
                || sameDistrictName(item.name, districtId, stateObj)
                || sameDistrictName(item.id, districtId, stateObj)
                || sameDistrictName(item.stateId, districtId, stateObj))[0];
            if(oldDistrict){
                const oldStats = getRaceStats(oldDistrict, false);
                previousParty = getFlippedCandidatePartyKey(oldStats.leader)
                    || scanPreviousParty(oldDistrict, 0, [], true);
            }
        }

        if(!previousParty) previousParty = scanPreviousParty(district) || scanPreviousParty(stateObj);

        const currentParty = getFlippedCandidatePartyKey(currentWinner);
        return !!(currentParty && previousParty && currentParty !== previousParty);
    };

    const getCandidateLastName = (cand) => {
        const fullName = getCandidateFullName(cand);
        if(!fullName) return "Unknown";
        const parts = fullName.trim().split(/\s+/);
        return parts.length > 1 ? parts[parts.length - 1] : parts[0];
    };

    const getCandidateFullName = (cand) => {
        if(!cand) return "";
        const direct = cand.name || cand.fullName || cand.displayName || cand.candidateName;
        if(direct) return String(direct);
        const first = cand.firstName || cand.fName || cand.givenName || cand.first;
        const last = cand.lastName || cand.lName || cand.surname || cand.last;
        return `${first || ""} ${last || ""}`.trim();
    };

    const getPrimaryCandidateName = (cand) => {
        const fullName = getCandidateFullName(cand);
        if(!fullName) return "Unknown";
        const parts = fullName.trim().split(/\s+/);
        if(parts.length <= 1) return parts[0];
        const initials = parts.slice(0, -1)
            .filter(part => part.length > 0)
            .map(part => `${part.charAt(0).toUpperCase()}.`)
            .join(" ");
        return `${initials} ${parts[parts.length - 1]}`.trim();
    };

    const getTooltipCandidateName = (cand, primary) => {
        if(primary) return getPrimaryCandidateName(cand);
        const props = tooltipComponents && tooltipComponents.properties ? tooltipComponents.properties : {};
        if(props.electionType === "usHouse") return getPrimaryCandidateName(cand);
        return getCandidateLastName(cand);
    };

    const getCandidateAnimationKey = (cand) => {
        if(!cand) return "unknown";
        return `${getPartyKey(cand)}:${getCandidateFullName(cand).toLowerCase()}`;
    };

    const candidateHasWinFlag = (cand) => {
        if(!cand) return false;
        return cand.pW === true
            || cand.winner === true
            || cand.won === true
            || cand.projected === true
            || cand.final === true
            || cand.advanced === true
            || cand.advance === true
            || cand.advances === true
            || cand.nominated === true
            || cand.nominee === true
            || cand.primaryWinner === true
            || cand.runoff === true
            || cand.inRunoff === true
            || cand.topTwo === true
            || cand.topFour === true;
    };

    const getPartyLabel = (cand) => {
        if(!cand) return "";
        const fallbackParty = cand.partyLabel || cand.partyName || cand.politicalParty || cand.affiliation || cand.caucusParty;
        if(fallbackParty) return String(fallbackParty).charAt(0).toUpperCase();
        if(cand.party === "I") return cand.caucus ? `I-${cand.caucus}` : "I";
        return cand.party || cand.caucus || "NP";
    };

    const getPartyDisplayName = (cand) => {
        const label = getPartyLabel(cand).charAt(0).toUpperCase();
        if(label === "D") return "Democrat";
        if(label === "R") return "Republican";
        if(label === "I") return "Independent";
        return getPartyLabel(cand) || "Candidate";
    };

    const getPartyClass = (cand) => {
        const party = getPartyLabel(cand).charAt(0).toLowerCase();
        if(party === "d") return "party-d";
        if(party === "r") return "party-r";
        return "party-i";
    };

    const possessiveName = (name) => {
        const text = String(name || "").trim();
        if(!text) return "";
        return text.endsWith("s") ? `${text}'` : `${text}'s`;
    };

    const getHouseDistrictTitle = (stateName, district, parentDistrict) => {
        const districts = parentDistrict && Array.isArray(parentDistrict.districts) ? parentDistrict.districts : [];
        if(districts.length === 1) return `${possessiveName(stateName)} At-Large Congressional District`;
        const districtNum = normalizeDistrictNumber(district);
        if(districtNum !== null) return `${possessiveName(stateName)} ${ordinal(districtNum)} Congressional District`;
        const fallback = district && (district.district || district.name);
        return fallback ? `${stateName} ${fallback}` : stateName;
    };

    const getHouseVotePartyKey = (cand) => {
        if(!cand) return "I";
        const party = String(cand.party || "").charAt(0).toUpperCase();
        if(party === "I") return "I";
        if(party === "D" || party === "R") return party;
        const caucus = String(cand.caucus || cand.caucusParty || "").toLowerCase();
        if(caucus.charAt(0) === "d" || caucus.indexOf("dem") !== -1) return "D";
        if(caucus.charAt(0) === "r" || caucus.indexOf("rep") !== -1) return "R";
        return "I";
    };

    const normalizeCandidateText = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const candidateImageCache = {};
    const candidateImageMissCache = {};

    const getCandidateCacheKey = (cand) => {
        const props = tooltipComponents && tooltipComponents.properties ? tooltipComponents.properties : {};
        return `${props.electionType || ""}:${props.districtId || ""}:${activeMap || ""}:${normalizeCandidateText(cand && cand.name)}:${getPartyLabel(cand).charAt(0)}`;
    };

    const getDirectCandidateImageSrc = (obj) => {
        if(!obj) return "";
        const possible = [
            obj.image,
            obj.img,
            obj.photo,
            obj.picture,
            obj.portrait,
            obj.portraitPath,
            obj.imagePath,
            obj.photoPath,
            obj.profileImage,
            obj.profilePic,
            obj.face,
            obj.avatar,
            obj.headshot,
            obj.headshotPath
        ];
        for(let i = 0; i < possible.length; i++){
            if(typeof possible[i] === "string" && possible[i].trim().length > 0) return possible[i];
        }
        return "";
    };

    const elementBelongsToTooltip = (elem) => {
        let current = elem;
        while(current){
            if(current === tooltipDiv) return true;
            current = current.parentElement;
        }
        return false;
    };

    const candidateTextScore = (text, cand) => {
        const normalizedText = normalizeCandidateText(text);
        const normalizedName = normalizeCandidateText(cand && cand.name);
        if(!normalizedText || !normalizedName) return 0;
        if(normalizedText.indexOf(normalizedName) !== -1) return 100;
        const parts = String(cand.name || "").trim().split(/\s+/).filter(Boolean);
        if(parts.length === 0) return 0;
        const lastName = normalizeCandidateText(parts[parts.length - 1]);
        const firstName = normalizeCandidateText(parts[0]);
        if(!lastName || normalizedText.indexOf(lastName) === -1) return 0;
        if(parts.length === 1) return 70;
        if(firstName && normalizedText.indexOf(firstName) !== -1) return 85;
        const initial = firstName ? firstName.charAt(0) : "";
        if(initial && normalizedText.indexOf(initial + lastName) !== -1) return 80;
        return 0;
    };

    const textMatchesCandidate = (text, cand) => candidateTextScore(text, cand) >= 80;

    const isPortraitSizedElement = (elem) => {
        if(!elem || !elem.getBoundingClientRect) return false;
        const rect = elem.getBoundingClientRect();
        if(rect.width < 35 || rect.height < 35 || rect.width > 190 || rect.height > 210) return false;
        const ratio = rect.width / Math.max(1, rect.height);
        return ratio >= 0.45 && ratio <= 1.55;
    };

    const getNearbyText = (elem) => {
        let current = elem;
        for(let depth = 0; current && depth < 7; depth++){
            let text = current.innerText || current.textContent || "";
            if(text && text.trim().length > 260) text = "";
            if((!text || text.trim().length === 0) && current.parentElement){
                const siblings = Array.from(current.parentElement.children || []);
                const index = siblings.indexOf(current);
                const nearby = [];
                if(index > 0) nearby.push(siblings[index - 1]);
                if(index >= 0 && index < siblings.length - 1) nearby.push(siblings[index + 1]);
                text = nearby.map(node => node.innerText || node.textContent || "").join(" ");
                if(text && text.trim().length > 260) text = "";
            }
            if(text && text.trim().length > 0) return text;
            current = current.parentElement;
        }
        return "";
    };

    const extractBackgroundImageUrl = (elem) => {
        if(!elem) return "";
        const bg = elem.style && elem.style.backgroundImage ? elem.style.backgroundImage : "";
        const match = /url\((['"]?)(.*?)\1\)/.exec(bg);
        return match && match[2] ? match[2] : "";
    };

    const getCandidateImageFromPage = (cand) => {
        if(!cand || !cand.name || typeof document === "undefined") return "";

        const imgs = Array.from(document.getElementsByTagName("img"));
        let bestSrc = "";
        let bestScore = 0;
        for(let i = 0; i < imgs.length; i++){
            const img = imgs[i];
            if(elementBelongsToTooltip(img)) continue;
            if(!isPortraitSizedElement(img)) continue;
            const src = img.currentSrc || img.src || img.getAttribute("src") || img.getAttribute("data-src") || "";
            const score = candidateTextScore(getNearbyText(img), cand);
            if(src && score > bestScore){
                bestScore = score;
                bestSrc = src;
            }
        }
        if(bestSrc && bestScore >= 80) return bestSrc;

        const elems = Array.from(document.querySelectorAll("[style]"));
        for(let i = 0; i < elems.length; i++){
            const elem = elems[i];
            if(elementBelongsToTooltip(elem)) continue;
            if(!isPortraitSizedElement(elem)) continue;
            const src = extractBackgroundImageUrl(elem);
            const score = candidateTextScore(getNearbyText(elem), cand);
            if(src && score > bestScore){
                bestScore = score;
                bestSrc = src;
            }
        }
        if(bestSrc && bestScore >= 80) return bestSrc;

        const canvases = Array.from(document.getElementsByTagName("canvas"));
        for(let i = 0; i < canvases.length; i++){
            const canvas = canvases[i];
            if(elementBelongsToTooltip(canvas)) continue;
            if(!isPortraitSizedElement(canvas)) continue;
            const score = candidateTextScore(getNearbyText(canvas), cand);
            if(score < 80) continue;
            try {
                const src = canvas.toDataURL("image/png");
                if(src) return src;
            } catch(err) {}
        }

        return "";
    };

    const getCandidateImageFromGameData = (cand) => {
        return "";
        if(!cand || !cand.name) return "";
        const seen = [];
        const party = getPartyLabel(cand).charAt(0);

        const searchObj = (obj, depth) => {
            if(!obj || depth > 6) return "";
            if(typeof obj !== "object") return "";
            if(seen.indexOf(obj) !== -1) return "";
            seen.push(obj);

            const direct = getDirectCandidateImageSrc(obj);
            const objParty = String(obj.party || obj.caucus || obj.caucusParty || "").charAt(0);
            if(direct && textMatchesCandidate(String(obj.name || obj.fullName || obj.firstName + " " + obj.lastName || ""), cand)
                && (!party || !objParty || objParty.toUpperCase() === party.toUpperCase())){
                return direct;
            }

            const keys = Object.keys(obj);
            for(let i = 0; i < keys.length; i++){
                const key = keys[i];
                if(key === "parentElement" || key === "children" || key === "ownerDocument") continue;
                const found = searchObj(obj[key], depth + 1);
                if(found) return found;
            }
            return "";
        };

        try {
            if(typeof Executive !== "undefined" && Executive.data){
                return searchObj(Executive.data.politicians, 0) || searchObj(Executive.data, 0);
            }
        } catch(err) {}
        return "";
    };

    const getCandidateImageSrc = (cand) => {
        if(!cand) return "";
        const cacheKey = getCandidateCacheKey(cand);
        if(candidateImageCache[cacheKey]) return candidateImageCache[cacheKey];
        if(candidateImageMissCache[cacheKey] && Date.now() - candidateImageMissCache[cacheKey] < 2500) return "";

        const direct = getDirectCandidateImageSrc(cand);
        if(direct){
            candidateImageCache[cacheKey] = direct;
            return direct;
        }
        if(cand.politician){
            const src = getCandidateImageSrc(cand.politician);
            if(src){
                candidateImageCache[cacheKey] = src;
                return src;
            }
        }
        if(cand.pol){
            const src = getCandidateImageSrc(cand.pol);
            if(src){
                candidateImageCache[cacheKey] = src;
                return src;
            }
        }
        const dataSrc = getCandidateImageFromGameData(cand);
        if(dataSrc){
            candidateImageCache[cacheKey] = dataSrc;
            return dataSrc;
        }
        const pageSrc = getCandidateImageFromPage(cand);
        if(pageSrc) candidateImageCache[cacheKey] = pageSrc;
        else candidateImageMissCache[cacheKey] = Date.now();
        return pageSrc;
    };

    const createCandidatePortrait = (cand) => {
        const slot = document.createElement("div");
        slot.className = `bm-nbc-portrait ${getPartyClass(cand)}`;

        const imageSrc = getCandidateImageSrc(cand);
        if(imageSrc){
            const img = document.createElement("img");
            img.className = "bm-nbc-portrait-img";
            img.src = imageSrc;
            img.onerror = () => {
                slot.classList.add("no-portrait");
                img.remove();
            };
            slot.appendChild(img);
        } else {
            slot.classList.add("no-portrait");
        }

        const label = document.createElement("span");
        label.className = "bm-nbc-portrait-party";
        const partyLabel = getPartyLabel(cand);
        label.innerText = partyLabel === "NP" ? "NP" : (partyLabel.charAt(0) || "I");
        slot.appendChild(label);
        return slot;
    };

    const makeBadge = (text, className) => {
        const badge = document.createElement("span");
        badge.className = `bm-nbc-badge ${className || ""}`;
        badge.innerText = text;
        return badge;
    };

    const normalizeRuleText = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const getNestedValue = (obj, keys) => {
        if(!obj) return undefined;
        for(let i = 0; i < keys.length; i++){
            const key = keys[i];
            if(Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
        }
        return undefined;
    };

    const settingEnabled = (value) => {
        if(value === true) return true;
        if(value === 1) return true;
        const text = normalizeRuleText(value);
        return text === "true" || text === "yes" || text === "enabled" || text === "active" || text === "on" || text === "rcv" || text === "rankedchoice";
    };

    const getStateRuleObjects = (districtId, district) => {
        const stateObj = getStateObj(districtId);
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const objects = [district, stateObj];
        try { if(Executive && Executive.data && Executive.data.states) objects.push(Executive.data.states[stateKey]); } catch(err) {}
        try { if(Executive && Executive.data && Executive.data.advOptions) objects.push(Executive.data.advOptions); } catch(err) {}
        try { if(typeof advOptions !== "undefined") objects.push(advOptions); } catch(err) {}
        try { if(typeof advancedOptions !== "undefined") objects.push(advancedOptions); } catch(err) {}
        try { if(typeof electionSettings !== "undefined") objects.push(electionSettings); } catch(err) {}
        return objects.filter(Boolean);
    };

    const objectTextHas = (obj, terms) => {
        if(!obj) return false;
        let text = "";
        try { text = normalizeRuleText(JSON.stringify(obj)); } catch(err) { text = normalizeRuleText(String(obj)); }
        return terms.some(term => text.indexOf(normalizeRuleText(term)) !== -1);
    };

    const objectHasEnabledRuleMarker = (obj, keyTerms, valueTerms, depth = 0) => {
        if(!obj || depth > 4) return false;
        if(typeof obj !== "object") return valueTerms.some(term => normalizeRuleText(obj).indexOf(normalizeRuleText(term)) !== -1);

        const keys = Object.keys(obj);
        for(let i = 0; i < keys.length; i++){
            const key = keys[i];
            const value = obj[key];
            const keyText = normalizeRuleText(key);
            const keyMatches = keyTerms.some(term => keyText.indexOf(normalizeRuleText(term)) !== -1);

            if(keyText.indexOf("norcv") !== -1 || keyText.indexOf("disablercv") !== -1 || keyText.indexOf("rcvdisabled") !== -1) continue;
            if(keyMatches && settingEnabled(value)) return true;
            if(keyMatches && typeof value === "string" && valueTerms.some(term => normalizeRuleText(value).indexOf(normalizeRuleText(term)) !== -1)) return true;
            if(typeof value === "object" && objectHasEnabledRuleMarker(value, keyTerms, valueTerms, depth + 1)) return true;
        }

        return false;
    };

    const getPrimaryAdvanceInfo = (districtId, district) => {
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const stateObj = getStateObj(districtId);
        const stateName = normalizeRuleText(stateObj ? stateObj.name : "");
        const objects = getStateRuleObjects(districtId, district);
        let topCount = null;
        let nonpartisan = false;

        objects.forEach(obj => {
            const count = getNestedValue(obj, ["topAdvance", "topAdvancers", "primaryAdvancers", "advanceCount", "numAdvance", "numAdvancers", "topPrimary"]);
            if(Number(count) === 2 || Number(count) === 4) topCount = Number(count);

            const format = getNestedValue(obj, ["primaryType", "primarySystem", "primaryFormat", "primaryElectionType", "primaryStyle"]);
            const text = normalizeRuleText(format);
            if(text.indexOf("toptwo") !== -1 || text.indexOf("top2") !== -1) topCount = 2;
            if(text.indexOf("topfour") !== -1 || text.indexOf("top4") !== -1) topCount = 4;
            if(text.indexOf("nonpartisan") !== -1 || text.indexOf("jungle") !== -1) nonpartisan = true;

            if(settingEnabled(getNestedValue(obj, ["nonpartisanPrimary", "junglePrimary", "openPrimaryAllCandidates"]))) nonpartisan = true;
            if(settingEnabled(getNestedValue(obj, ["topTwoPrimary", "top2Primary"]))) topCount = 2;
            if(settingEnabled(getNestedValue(obj, ["topFourPrimary", "top4Primary"]))) topCount = 4;
        });

        if(topCount === null && (stateKey === "ak" || stateName === "alaska")) topCount = 4;
        if(topCount === null && (stateKey === "ca" || stateKey === "wa" || stateName === "california" || stateName === "washington")) topCount = 2;
        if(topCount === 2 || topCount === 4) nonpartisan = true;

        return { topCount, nonpartisan };
    };

    const isRcvActiveForRace = (districtId, district) => {
        const objects = getStateRuleObjects(districtId, district);
        const stateObj = getStateObj(districtId);
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const stateName = normalizeRuleText(stateObj ? stateObj.name : "");
        let active = false;

        if(stateKey === "ak" || stateName === "alaska") active = true;
        objects.forEach(obj => {
            if(settingEnabled(getNestedValue(obj, ["rcv", "RCV", "rankedChoice", "rankedChoiceVoting", "instantRunoff", "useRCV", "rcvActive"]))) active = true;
            if(objectHasEnabledRuleMarker(obj, ["rcv", "ranked", "instantRunoff"], ["rcv", "rankedChoice", "ranked choice", "instantRunoff"])) active = true;
        });

        return active;
    };

    const isRcvUsedInGeneral = (districtId, district, live) => {
        if(!district || !isRcvActiveForRace(districtId, district)) return false;
        if(district.pW === true || !live){
            if(!hasMajorityWinner(district, live)) return true;
        }

        const objects = getStateRuleObjects(districtId, district);
        return objects.some(obj => objectHasEnabledRuleMarker(obj, ["rcvused", "usedrcv", "rankedchoiceused", "instantRunoffUsed"], ["used", "true", "active"]));
    };

    const isRunoffThresholdState = (districtId) => {
        const stateObj = getStateObj(districtId);
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const stateName = normalizeRuleText(stateObj ? stateObj.name : "");
        return stateKey === "ga" || stateKey === "la" || stateName === "georgia" || stateName === "louisiana";
    };

    const isProportionalElectoralCollegeState = (districtId, district) => {
        const stateObj = getStateObj(districtId);
        const stateKey = String(districtId || activeMap || "").toLowerCase();
        const stateName = normalizeRuleText(stateObj ? stateObj.name : "");
        if(stateKey === "me" || stateKey === "ne" || stateName === "maine" || stateName === "nebraska") return true;

        const objects = getStateRuleObjects(districtId, district);
        let proportional = false;
        objects.forEach(obj => {
            if(settingEnabled(getNestedValue(obj, [
                "proportionalElectoralCollege",
                "proportionalEC",
                "proportionalElectors",
                "splitElectoralVotes",
                "electoralVoteProportional",
                "electoralCollegeProportional"
            ]))) proportional = true;

            const method = getNestedValue(obj, [
                "electoralCollegeMethod",
                "electoralVoteMethod",
                "ecMethod",
                "presidentialElectorMethod",
                "electoralVoteAllocation"
            ]);
            const methodText = normalizeRuleText(method);
            if(methodText.indexOf("proportional") !== -1 || methodText.indexOf("districtmethod") !== -1 || methodText.indexOf("congressionaldistrict") !== -1) proportional = true;
            if(objectTextHas(obj, [
                "proportional electoral college",
                "proportional electors",
                "proportional electoral votes",
                "electoral votes distributed proportionately",
                "congressional district electoral votes"
            ])) proportional = true;
        });

        return proportional;
    };

    const hasMajorityWinner = (district, live) => {
        const stats = getRaceStats(district, live);
        if(!stats || !stats.leader || stats.total <= 0) return false;
        return (candidateVotes(stats.leader, live) / stats.total) > 0.5;
    };

    const getElectionRuleIndicators = (electionType, districtId, district, live, countyView, primary) => {
        if(countyView) return [];
        const indicators = [];

        if(primary){
            const primaryInfo = getPrimaryAdvanceInfo(districtId, district);
            if(primaryInfo.topCount === 2) indicators.push({ text: "TOP TWO ADVANCE", className: "badge-election-rule" });
            if(primaryInfo.topCount === 4) indicators.push({ text: "TOP FOUR ADVANCE", className: "badge-election-rule" });
            if(primaryInfo.nonpartisan) indicators.push({ text: "NONPARTISAN PRIMARY", className: "badge-election-rule" });
            return indicators;
        }

        if(electionType === "president"){
            if(isProportionalElectoralCollegeState(districtId, district)){
                indicators.push({ text: "PROPORTIONAL EC", className: "badge-election-rule" });
            }
            return indicators;
        }

        const rcvActive = isRcvActiveForRace(districtId, district);
        if(!rcvActive) return indicators;

        if(isRunoffThresholdState(districtId)){
            indicators.push({ text: "50% TO AVOID RUNOFF", className: "badge-runoff-rule" });
            if((district.pW === true || !live) && !hasMajorityWinner(district, live)){
                indicators.push({ text: "RUNOFF", className: "badge-runoff" });
            }
        } else {
            if(isRcvUsedInGeneral(districtId, district, live)){
                indicators.push({ text: "RCV USED", className: "badge-rcv-used" });
            } else {
                indicators.push({ text: "RCV: 50% NEEDED", className: "badge-election-rule" });
            }
        }

        return indicators;
    };

    const clearNode = (node) => {
        while(node.firstChild) node.firstChild.remove();
    };

    const setHeaderBattleground = (show) => {
        if(!tooltipComponents.battlegroundHeader) return;
        if(show) tooltipComponents.battlegroundHeader.removeAttribute("style");
        else tooltipComponents.battlegroundHeader.style.setProperty("display", "none", "important");
    };

    const getRaceIndicators = (electionType, district, districtId, live, countyView) => {
        if(countyView) return [];
        const stats = getRaceStats(district, live);
        const indicators = [];
        const isStatewideRace = electionType === "president" || electionType === "usSenate" || electionType === "governor";
        const registrationGap = getStateRegistrationGap(districtId);
        const battlegroundByRegistration = isStatewideRace && registrationGap !== null && registrationGap < 5;

        if(battlegroundByRegistration){
            indicators.push({ text: "BATTLEGROUND", className: "badge-battleground" });
        }

        const reporting = safeNum(district.totalVotes) > 0 ? safeNum(district.totalCurrVotes) / safeNum(district.totalVotes) : (district.pW === true ? 1 : 0);
        const tipping = String(`${district.rating || ""} ${district.raceRating || ""} ${district.status || ""} ${district.notes || ""}`).toLowerCase().match(/tipping|toss|key/);
        const projectedRace = district.pW === true
            || district.projected === true
            || district.final === true
            || (Array.isArray(district.cands) && district.cands.some(candidateHasWinFlag));

        if(electionType === "president" && battlegroundByRegistration && stats.total > 0 && stats.marginPct < 8){
            indicators.push({ text: "RACE TO WATCH", className: "badge-watch" });
        }

        if((electionType === "usSenate" || electionType === "governor") && stats.total > 0 && stats.marginPct < 5){
            indicators.push({ text: "RACE TO WATCH", className: "badge-watch" });
        }

        if(live && !projectedRace && reporting >= 0 && reporting <= 0.65){
            indicators.push({ text: "TOO EARLY TO CALL", className: "badge-tetc" });
        } else if(live && !projectedRace && reporting >= 0.70 && reporting < 1){
            indicators.push({ text: "TOO CLOSE TO CALL", className: "badge-tctc" });
        }

        if(stats.total > 0 && (stats.marginPct < tooltipSettings.keyRaceThreshold || tipping)){
            indicators.push({ text: tipping ? "TIPPING POINT" : "KEY RACE", className: tipping ? "badge-tipping" : "badge-key" });
        }

        return indicators;
    };

    const clamp = (num, min, max) => Math.max(min, Math.min(max, num));

    const firstFinite = (...values) => {
        for(const value of values){
            if(value === undefined || value === null || value === "") continue;
            const n = Number(value);
            if(Number.isFinite(n)) return n;
        }
        return null;
    };

    const normalizeShare = (value) => {
        const n = Number(value);
        if(!Number.isFinite(n)) return null;
        return (Math.abs(n) <= 1) ? n * 100 : n;
    };

    const firstLeanValue = (...values) => {
        let neutral = null;
        for(let i = 0; i < values.length; i++){
            const value = values[i];
            if(value === undefined || value === null || value === "") continue;
            const n = Number(value);
            if(!Number.isFinite(n)) continue;
            if(Math.abs(n) >= 0.5) return n;
            if(neutral === null) neutral = n;
        }
        return neutral;
    };

    const parsePviValue = (value) => {
        if(value === undefined || value === null) return null;
        const numeric = Number(value);
        if(Number.isFinite(numeric)) return numeric;
        const text = String(value).trim().toUpperCase();
        const demShareMatch = text.match(/\bD(?:EM(?:OCRAT(?:IC)?)?S?)?\s*:?\s*(\d+(?:\.\d+)?)\s*%?/);
        const repShareMatch = text.match(/\bR(?:EP(?:UBLICAN)?S?)?\s*:?\s*(\d+(?:\.\d+)?)\s*%?/);
        if(demShareMatch && repShareMatch) return Number(demShareMatch[1]) - Number(repShareMatch[1]);
        const partyMatch = text.match(/([DR])\s*\+?\s*(\d+(?:\.\d+)?)/);
        if(partyMatch) return (partyMatch[1] === "D" ? 1 : -1) * Number(partyMatch[2]);
        const signedMatch = text.match(/-?\d+(?:\.\d+)?/);
        return signedMatch ? Number(signedMatch[0]) : null;
    };

    const getPviRawFromObject = (obj, depth = 0, seen = []) => {
        if(!obj || depth > 4 || seen.indexOf(obj) !== -1) return null;
        seen.push(obj);

        const direct = firstFinite(
            parsePviValue(obj.pvi),
            parsePviValue(obj.PVI),
            parsePviValue(obj.districtPvi),
            parsePviValue(obj.districtPVI),
            parsePviValue(obj.cookPvi),
            parsePviValue(obj.cookPVI),
            parsePviValue(obj.partisanLean),
            parsePviValue(obj.partisan_lean),
            parsePviValue(obj.lean),
            parsePviValue(obj.partisanIndex),
            parsePviValue(obj.partisanVotingIndex),
            parsePviValue(obj.districtLean)
        );
        if(direct !== null) return direct;

        const demShare = normalizeShare(firstFinite(obj.demPop, obj.dem, obj.demShare, obj.democraticShare, obj.democratShare, obj.democraticPop, obj.democratPop, obj.demPct, obj.demPercent, obj.D));
        const repShare = normalizeShare(firstFinite(obj.repPop, obj.rep, obj.repShare, obj.republicanShare, obj.republicanPop, obj.repPct, obj.repPercent, obj.R));

        if(demShare !== null && repShare !== null) return demShare - repShare;

        const keys = Object.keys(obj);
        for(let i = 0; i < keys.length; i++){
            const key = keys[i];
            const value = obj[key];
            const keyText = key.toLowerCase();
            if(keyText.indexOf("pvi") !== -1 || keyText.indexOf("partisan") !== -1 || keyText.indexOf("lean") !== -1){
                const parsed = parsePviValue(value);
                if(parsed !== null) return parsed;
            } else if(keyText.indexOf("district") !== -1 && /\bD(?:EM(?:OCRAT(?:IC)?)?S?)?\s*:?\s*\d+(?:\.\d+)?\s*%?/i.test(String(value)) && /\bR(?:EP(?:UBLICAN)?S?)?\s*:?\s*\d+(?:\.\d+)?\s*%?/i.test(String(value))){
                const parsed = parsePviValue(value);
                if(parsed !== null) return parsed;
            }
            if(value && typeof value === "object"){
                const nested = getPviRawFromObject(value, depth + 1, seen);
                if(nested !== null) return nested;
            }
        }
        return null;
    };

    const normalizeDistrictNumber = (district) => {
        const raw = String(district && (district.district || district.name || district.id || district.districtId || district.districtNum || district.districtNumber || district.number || district.cd) || "");
        const match = raw.match(/\d+/);
        if(match) return Number(match[0]);
        if(district && district._betterMapsDistrictIndex !== undefined) return safeNum(district._betterMapsDistrictIndex, -1) + 1;
        return null;
    };

    const getNestedDistrictNumber = (obj, depth = 0, seen = []) => {
        if(!obj || depth > 3 || seen.indexOf(obj) !== -1) return null;
        seen.push(obj);
        const direct = normalizeDistrictNumber(obj);
        if(direct !== null) return direct;
        const keys = Object.keys(obj);
        for(let i = 0; i < keys.length; i++){
            const value = obj[keys[i]];
            if(value === undefined || value === null) continue;
            if(typeof value !== "object"){
                const keyText = keys[i].toLowerCase();
                if(keyText.indexOf("district") !== -1 || keyText === "cd" || keyText === "seat"){
                    const match = String(value).match(/\d+/);
                    if(match) return Number(match[0]);
                }
            } else {
                const nested = getNestedDistrictNumber(value, depth + 1, seen);
                if(nested !== null) return nested;
            }
        }
        return null;
    };

    const collectDistrictLookupObjects = (source, districtNum, output, depth = 0, seen = []) => {
        if(!source || districtNum === null || depth > 5 || seen.indexOf(source) !== -1) return;
        seen.push(source);
        if(Array.isArray(source)){
            source.forEach(item => collectDistrictLookupObjects(item, districtNum, output, depth + 1, seen));
            return;
        }
        if(typeof source !== "object") return;
        if(normalizeDistrictNumber(source) === districtNum) output.push(source);
        Object.keys(source).forEach(key => {
            const value = source[key];
            if(value && typeof value === "object") collectDistrictLookupObjects(value, districtNum, output, depth + 1, seen);
        });
    };

    const getHouseDistrictLookupObjects = (district, districtId) => {
        const stateId = String((district && (district.state || district.stateId || district._betterMapsStateId)) || districtId || "").toLowerCase().split("__")[0];
        const stateObj = getStateObj(stateId);
        const districtNum = normalizeDistrictNumber(district);
        const objects = [district];
        const possibleArrays = [];
        if(stateObj){
            ["districts", "congressionalDistricts", "houseDistricts", "usHouseDistricts", "congDistricts", "cds"].forEach(key => {
                if(Array.isArray(stateObj[key])) possibleArrays.push(stateObj[key]);
            });
        }
        if(Executive.data.politicians && Executive.data.politicians.usHouse && Array.isArray(Executive.data.politicians.usHouse[stateId])){
            possibleArrays.push(Executive.data.politicians.usHouse[stateId]);
        }
        possibleArrays.forEach(list => {
            list.forEach(item => {
                if(districtNum !== null && getNestedDistrictNumber(item) === districtNum) objects.push(item);
            });
        });
        collectDistrictLookupObjects(stateObj, districtNum, objects);
        if(Executive.data.politicians && Executive.data.politicians.usHouse){
            collectDistrictLookupObjects(Executive.data.politicians.usHouse[stateId], districtNum, objects);
        }
        return objects.filter(Boolean);
    };

    const getHouseDistrictPviInfo = (district, districtId) => {
        const stateId = String((district && (district.state || district.stateId || district._betterMapsStateId)) || districtId || "").toLowerCase().split("__")[0];
        const districtNum = normalizeDistrictNumber(district);
        const objects = getHouseDistrictLookupObjects(district, districtId);
        for(let i = 0; i < objects.length; i++){
            const raw = getPviRawFromObject(objects[i]);
            if(raw !== null){
                const normalized = Math.abs(raw) <= 1 ? raw * 100 : raw;
                if(Math.abs(normalized) < 0.5) return { value: null, party: "", label: "PVI N/A", source: "" };
                return {
                    value: Math.abs(normalized),
                    party: normalized >= 0.5 ? "D" : "R",
                    label: `PVI ${normalized > 0 ? "D" : "R"}+${formatPercent(Math.abs(normalized))}`,
                    source: "district"
                };
            }
        }
        const planPvi = houseDistrictPviData.getHouseDistrictPvi(stateId, districtNum);
        if(planPvi && Number.isFinite(planPvi.rawPvi)){
            const normalized = planPvi.rawPvi;
            if(Math.abs(normalized) < 0.5) return { value: null, party: "", label: "PVI N/A", source: "" };
            return {
                value: Math.abs(normalized),
                party: normalized >= 0.5 ? "D" : "R",
                label: `PVI ${normalized > 0 ? "D" : "R"}+${formatPercent(Math.abs(normalized))}`,
                source: "district"
            };
        }
        return { value: null, party: "", label: "PVI N/A", source: "" };
    };

    const getVoteLeanFromCandidates = (district, live) => {
        if(!district || !district.cands) return null;
        let demVotes = 0;
        let repVotes = 0;
        let totalVotes = 0;
        district.cands.forEach(cand => {
            const votes = candidateVotes(cand, live);
            const party = getPartyLabel(cand).charAt(0).toUpperCase();
            if(party === "D") demVotes += votes;
            else if(party === "R") repVotes += votes;
            totalVotes += votes;
        });
        if(totalVotes <= 0 || (demVotes <= 0 && repVotes <= 0)) return null;
        return ((demVotes - repVotes) / totalVotes) * 100;
    };

    const getIndependentShareFromObject = (obj) => {
        if(!obj) return null;
        return normalizeShare(firstFinite(obj.indPop, obj.ind, obj.indShare, obj.independentShare, obj.I));
    };

    const getCountyPviInfo = (countyDistrict) => {
        const pviRaw = firstLeanValue(
            getPviRawFromObject(countyDistrict),
            getPviRawFromObject(countyDistrict._countyElectData),
            getPviRawFromObject(countyDistrict._origCounty),
            getPviRawFromObject(countyDistrict._stateElectData),
            getVoteLeanFromCandidates(countyDistrict._origCounty, false),
            getVoteLeanFromCandidates(countyDistrict, false),
            getPviRawFromObject(getStateObj(activeMap.toLowerCase()))
        );

        const indShare = firstFinite(
            getIndependentShareFromObject(countyDistrict._countyElectData),
            getIndependentShareFromObject(countyDistrict._origCounty),
            getIndependentShareFromObject(countyDistrict._stateElectData),
            getIndependentShareFromObject(getStateObj(activeMap.toLowerCase())),
            0
        );

        const raw = Number.isFinite(pviRaw) ? pviRaw : null;
        return {
            raw,
            expectedD: raw === null ? 50 : clamp(50 + (raw / 2), 0, 100),
            expectedR: raw === null ? 50 : clamp(50 - (raw / 2), 0, 100),
            expectedI: clamp(indShare || 0, 0, 100)
        };
    };

    const getPartyShare = (district, live, partyCode) => {
        const total = districtVotes(district, live);
        if(total <= 0 || !district || !district.cands) return 0;

        const partyVotes = district.cands
            .filter(cand => getPartyLabel(cand).charAt(0).toUpperCase() === partyCode)
            .reduce((sum, cand) => sum + candidateVotes(cand, live), 0);

        return (partyVotes / total) * 100;
    };

    const firstDelegateValue = (...values) => {
        for(let i = 0; i < values.length; i++){
            const n = Number(values[i]);
            if(Number.isFinite(n) && n >= 0) return n;
        }
        return null;
    };

    const getPrimaryDelegateTotal = (party, source, parentDistrict) => {
        const stateObj = getStateObj(activeMap);
        const partyLower = String(party || "").toLowerCase();
        const partyName = partyLower === "d" ? "Dem" : (partyLower === "r" ? "Rep" : "");
        const partyFull = partyLower === "d" ? "democratic" : (partyLower === "r" ? "republican" : "");
        return firstDelegateValue(
            source && source.delegates,
            source && source.delegateCount,
            source && source.totalDelegates,
            source && source.primaryDelegates,
            source && source[`${partyLower}Delegates`],
            source && source[`${partyName}Delegates`],
            source && source[`${partyFull}Delegates`],
            source && source[`${partyLower}PrimaryDelegates`],
            source && source[`${partyName}PrimaryDelegates`],
            source && source[`${partyFull}PrimaryDelegates`],
            parentDistrict && parentDistrict[`${partyLower}Delegates`],
            parentDistrict && parentDistrict[`${partyName}Delegates`],
            parentDistrict && parentDistrict[`${partyFull}Delegates`],
            stateObj && stateObj[`${partyLower}Delegates`],
            stateObj && stateObj[`${partyName}Delegates`],
            stateObj && stateObj[`${partyFull}Delegates`],
            stateObj && stateObj[`${partyLower}PrimaryDelegates`],
            stateObj && stateObj[`${partyName}PrimaryDelegates`],
            stateObj && stateObj[`${partyFull}PrimaryDelegates`]
        );
    };

    const isWinnerTakeAllPrimary = (party, source, parentDistrict) => {
        const partyKey = String(party || "").charAt(0).toUpperCase();
        const objects = [source, parentDistrict, getStateObj(activeMap)].filter(Boolean);
        let winnerTakeAll = false;
        objects.forEach(obj => {
            if(settingEnabled(getNestedValue(obj, [
                "winnerTakeAll",
                "wta",
                "winnerTakeAllPrimary",
                "winnerTakeAllDelegates",
                `${partyKey.toLowerCase()}WinnerTakeAll`,
                `${partyKey.toLowerCase()}WTA`,
                `${partyKey === "R" ? "rep" : "dem"}WinnerTakeAll`,
                `${partyKey === "R" ? "republican" : "democratic"}WinnerTakeAll`
            ]))) winnerTakeAll = true;
            if(objectTextHas(obj, ["winner take all", "winner-take-all", "wta"])) winnerTakeAll = true;
        });
        return winnerTakeAll;
    };

    const getCandidateDelegateCount = (cand, district, live) => {
        const direct = firstDelegateValue(
            cand && cand.delegates,
            cand && cand.delegateCount,
            cand && cand.pledgedDelegates,
            cand && cand.primaryDelegates
        );
        if(direct !== null) return direct;
        if(!district || tooltipComponents.properties.electionType !== "president") return null;
        const delegateTotal = firstDelegateValue(district._primaryDelegateTotal);
        if(delegateTotal === null || delegateTotal <= 0) return null;
        const totalVotes = districtVotes(district, live);
        if(totalVotes <= 0) return null;
        return Math.round(delegateTotal * (candidateVotes(cand, live) / totalVotes));
    };

    const getCountyTrendInfo = (countyDistrict, parentDistrict, live) => {
        if(!countyDistrict || !countyDistrict._countyView) return null;

        const threshold = tooltipSettings.countyTrendThreshold;
        const pvi = getCountyPviInfo(countyDistrict);

        const demShare = getPartyShare(countyDistrict, live, "D");
        const repShare = getPartyShare(countyDistrict, live, "R");
        const indShare = getPartyShare(countyDistrict, live, "I");

        const demDelta = demShare - pvi.expectedD;
        const repDelta = repShare - pvi.expectedR;
        const indDelta = indShare - pvi.expectedI;

        const possible = [];
        if(demDelta >= threshold) possible.push({ arrow: "â†", label: "BLUE", delta: demDelta, className: "trend-blue" });
        if(repDelta >= threshold) possible.push({ arrow: "â†’", label: "RED", delta: repDelta, className: "trend-red" });
        if(indShare >= 30 && indDelta >= threshold) possible.push({ arrow: "â–²", label: "GRAY", delta: indDelta, className: "trend-gray" });

        if(possible.length === 0) return null;
        possible.sort((a, b) => b.delta - a.delta);
        return possible[0];
    };

    const appendMeta = (electionType, district, districtId, live, countyView, parentDistrict) => {
        clearNode(tooltipComponents.meta);
        tooltipComponents.properties.bottomIndicators = [];
        setHeaderBattleground(false);

        const stats = getRaceStats(district, live);
        const metaLine = document.createElement("div");
        metaLine.className = "bm-nbc-meta-line";

        if(countyView){
            const localityNode = document.createElement("span");
            localityNode.className = "bm-nbc-margin";
            localityNode.innerText = getSubdivisionLabel(activeMap).toUpperCase();
            metaLine.appendChild(localityNode);
        }

        if(stats.total > 0){
            const marginNode = document.createElement("span");
            marginNode.className = `bm-nbc-margin-group ${getPartyClass(stats.leader)}`;
            const partyNode = document.createElement("span");
            partyNode.className = "bm-nbc-margin-party";
            partyNode.innerText = getPartyLabel(stats.leader).charAt(0).toUpperCase() || "I";
            const valueNode = document.createElement("span");
            valueNode.className = "bm-nbc-margin bm-nbc-lead-margin";
            valueNode.innerText = `+${formatNumber(stats.marginVotes)} (${formatPercent(stats.marginPct)}%)`;
            try {
                partyNode.style.setProperty("background-color", stringifyColour(getCandidateColour(stats.leader)), "important");
                partyNode.style.setProperty("color", "#ffffff", "important");
                partyNode.style.setProperty("border-color", "#ffffff", "important");
                valueNode.style.setProperty("border-color", stringifyColour(getCandidateColour(stats.leader)), "important");
            } catch(err) {}
            marginNode.appendChild(partyNode);
            marginNode.appendChild(valueNode);
            metaLine.appendChild(marginNode);
        }

        if(countyView && district && district.votingPopulation){
            const votersNode = document.createElement("span");
            votersNode.className = "bm-nbc-margin bm-nbc-voting-pop";
            votersNode.innerText = `VOTING POP: ${formatNumber(district.votingPopulation)}`;
            metaLine.appendChild(votersNode);
        }

        tooltipComponents.meta.appendChild(metaLine);

        const indicatorRow = document.createElement("div");
        indicatorRow.className = "bm-nbc-indicators";
        if(district._betterMapsFlipped === true && !countyView){
            indicatorRow.appendChild(makeBadge(electionType === "president" ? "PRESIDENTIAL FLIP" : "FLIPPED", `badge-flipped ${getPartyClass(stats.leader)}`));
        }
        getElectionRuleIndicators(electionType, districtId, district, live, countyView, false).forEach(ind => {
            indicatorRow.appendChild(makeBadge(ind.text, ind.className));
        });
        getRaceIndicators(electionType, district, districtId, live, countyView).forEach(ind => {
            if(ind.className === "badge-battleground"){
                setHeaderBattleground(true);
                return;
            }
            if(ind.className === "badge-key" || ind.className === "badge-tipping"){
                tooltipComponents.properties.bottomIndicators.push(ind);
                return;
            }
            indicatorRow.appendChild(makeBadge(ind.text, ind.className));
        });
        if(indicatorRow.children.length > 0) tooltipComponents.meta.appendChild(indicatorRow);
    };

    const appendBottomIndicators = () => {
        const indicators = tooltipComponents.properties && Array.isArray(tooltipComponents.properties.bottomIndicators)
            ? tooltipComponents.properties.bottomIndicators
            : [];
        if(indicators.length === 0) return;
        const row = document.createElement("div");
        row.className = "bm-nbc-bottom-indicators";
        indicators.forEach(ind => row.appendChild(makeBadge(ind.text, ind.className)));
        tooltipComponents.entries.appendChild(row);
    };

    const appendPrimaryRuleMeta = (electionType, district, districtId, live, countyView) => {
        clearNode(tooltipComponents.meta);
        tooltipComponents.properties.bottomIndicators = [];
        setHeaderBattleground(false);
        const indicatorRow = document.createElement("div");
        indicatorRow.className = "bm-nbc-indicators";
        getElectionRuleIndicators(electionType, districtId, district, live, countyView, true).forEach(ind => {
            indicatorRow.appendChild(makeBadge(ind.text, ind.className));
        });
        if(indicatorRow.children.length > 0) tooltipComponents.meta.appendChild(indicatorRow);
    };

    const getCandidateElectoralVoteDirectValue = (cand) => {
        if(!cand) return null;
        return firstFinite(
            cand.electoralVotesWon,
            cand.electoralVotesEarned,
            cand.electoralVotesAwarded,
            cand.electoralVotes,
            cand.electoralVoteCount,
            cand.electoralVote,
            cand.electorsWon,
            cand.electors,
            cand.evWon,
            cand.evs,
            cand.EV
        );
    };

    const getCandidateLookupKeys = (cand) => {
        return [
            cand && cand.id,
            cand && cand.candId,
            cand && cand.candidateId,
            cand && cand.name,
            cand && cand.fullName,
            cand && cand.displayName,
            cand && cand.candidateName,
            getCandidateFullName(cand),
            getCandidateLastName(cand)
        ].map(value => normalizeCandidateText(value)).filter(Boolean);
    };

    const getMappedElectoralVotes = (cand, district) => {
        if(!cand || !district) return null;
        const maps = [
            district.electoralVotesByCandidate,
            district.candidateElectoralVotes,
            district.electoralVoteResults,
            district.electoralVotesWon,
            district.electorResults,
            district.evResults
        ].filter(Boolean);
        const keys = getCandidateLookupKeys(cand);

        for(let i = 0; i < maps.length; i++){
            const map = maps[i];
            if(Array.isArray(map)){
                for(let j = 0; j < map.length; j++){
                    const item = map[j];
                    const itemKeys = getCandidateLookupKeys(item).concat([
                        normalizeCandidateText(item && item.candidate),
                        normalizeCandidateText(item && item.candidateName),
                        normalizeCandidateText(item && item.name)
                    ]).filter(Boolean);
                    if(keys.some(key => itemKeys.indexOf(key) !== -1)){
                        const value = firstFinite(item.electoralVotes, item.electors, item.ev, item.votes, item.count);
                        if(value !== null) return value;
                    }
                }
            } else if(typeof map === "object"){
                for(let j = 0; j < keys.length; j++){
                    if(Object.prototype.hasOwnProperty.call(map, keys[j])){
                        const value = firstFinite(map[keys[j]]);
                        if(value !== null) return value;
                    }
                }
                const mapKeys = Object.keys(map);
                for(let j = 0; j < mapKeys.length; j++){
                    const normalizedKey = normalizeCandidateText(mapKeys[j]);
                    if(keys.indexOf(normalizedKey) !== -1){
                        const value = firstFinite(map[mapKeys[j]]);
                        if(value !== null) return value;
                    }
                }
            }
        }
        return null;
    };

    const getLargestRemainderElectoralVoteAward = (cand, district, live, electoralVotes) => {
        if(!cand || !district || !Array.isArray(district.cands) || electoralVotes <= 0) return 0;
        const total = districtVotes(district, live);
        if(total <= 0) return 0;
        const rows = district.cands.map(candidate => {
            const exact = (candidateVotes(candidate, live) / total) * electoralVotes;
            return {
                candidate,
                floor: Math.floor(exact),
                remainder: exact - Math.floor(exact),
                votes: candidateVotes(candidate, live)
            };
        });
        let assigned = rows.reduce((sum, row) => sum + row.floor, 0);
        rows.sort((a, b) => {
            if(b.remainder !== a.remainder) return b.remainder - a.remainder;
            return b.votes - a.votes;
        });
        for(let i = 0; assigned < electoralVotes && i < rows.length; i++, assigned++){
            rows[i].floor++;
        }
        const matched = rows.filter(row => row.candidate === cand)[0];
        return matched ? matched.floor : 0;
    };

    const getCandidateElectoralVoteBadge = (cand, district, live, isWinner, primary) => {
        if(primary || !cand || !district || district._countyView) return null;
        if(!tooltipComponents.properties || tooltipComponents.properties.electionType !== "president") return null;
        const stateObj = getStateObj(tooltipComponents.properties.districtId || activeMap);
        const electoralVotes = safeNum(stateObj && stateObj.electoralNum);
        if(electoralVotes <= 0) return null;
        if(isProportionalElectoralCollegeState(tooltipComponents.properties.districtId || activeMap, district)){
            const direct = getCandidateElectoralVoteDirectValue(cand);
            const mapped = getMappedElectoralVotes(cand, district);
            const awarded = direct !== null
                ? direct
                : (mapped !== null ? mapped : getLargestRemainderElectoralVoteAward(cand, district, live, electoralVotes));
            return awarded > 0 ? `[${formatNumber(awarded)} EVs]` : null;
        }
        return isWinner ? `[${formatNumber(electoralVotes)} EVs]` : null;
    };

    const createFallbackTooltipEntry = (cand, district, live, winner, primary, primaryStatusText) => {
        const isWinner = ((winner && typeof winner.has === "function") ? winner.has(cand) : cand === winner) || candidateHasWinFlag(cand);
        const row = document.createElement("div");
        row.className = `bm-nbc-row ${isWinner ? "is-winner" : ""}`;
        row.setAttribute("data-candidate-key", getCandidateAnimationKey(cand));

        const party = document.createElement("div");
        party.className = `bm-nbc-party ${getPartyClass(cand)}`;
        const partyLabel = getPartyLabel(cand);
        party.innerText = partyLabel === "NP" ? "NP" : (partyLabel.charAt(0) || "I");
        row.appendChild(party);

        const name = document.createElement("div");
        name.className = "bm-nbc-name";
        const nameText = document.createElement("span");
        nameText.className = "bm-nbc-name-text";
        nameText.innerText = getTooltipCandidateName(cand, primary);
        name.appendChild(nameText);
        const evText = getCandidateElectoralVoteBadge(cand, district, live, isWinner, primary);
        if(evText){
            const evBadge = document.createElement("span");
            evBadge.className = "bm-nbc-ev-badge";
            evBadge.innerText = evText;
            name.appendChild(evBadge);
        }
        if(isWinner){
            const check = document.createElement("span");
            check.className = "bm-nbc-check";
            check.textContent = "\u2714";
            name.appendChild(check);
            const rowStatusText = primary ? primaryStatusText : "Projected Winner";
            if(rowStatusText){
                const status = document.createElement("span");
                status.className = "bm-nbc-primary-status";
                status.innerText = rowStatusText;
                name.appendChild(status);
            }
        }
        row.appendChild(name);

        const votes = candidateVotes(cand, live);
        const total = districtVotes(district, live);
        const pct = total > 0 ? (votes / total) * 100 : 0;

        const voteNode = document.createElement("div");
        voteNode.className = "bm-nbc-votes";
        voteNode.innerText = formatNumber(votes);
        row.appendChild(voteNode);

        const pctWrap = document.createElement("div");
        pctWrap.className = "bm-nbc-pct-wrap";
        const pctNode = document.createElement("div");
        pctNode.className = "bm-nbc-pct";
        pctNode.innerText = `${formatPercent(pct)}%`;
        pctWrap.appendChild(pctNode);
        const barTrack = document.createElement("div");
        barTrack.className = "bm-nbc-bar-track";
        const bar = document.createElement("div");
        bar.className = "bm-nbc-bar";
        bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        barTrack.appendChild(bar);
        pctWrap.appendChild(barTrack);
        row.appendChild(pctWrap);

        return row;
    };

    const createTooltipEntry = (cand, district, live, winner, primary, primaryStatusText) => {
        if(!cand) return document.createElement("div");
        const isWinner = ((winner && typeof winner.has === "function") ? winner.has(cand) : cand === winner) || candidateHasWinFlag(cand);
        const row = document.createElement("div");
        row.className = `bm-nbc-row ${isWinner ? "is-winner" : ""}`;
        row.setAttribute("data-candidate-key", getCandidateAnimationKey(cand));

        row.appendChild(createCandidatePortrait(cand));

        const name = document.createElement("div");
        name.className = "bm-nbc-name";
        const nameText = document.createElement("span");
        nameText.className = "bm-nbc-name-text";
        nameText.innerText = getTooltipCandidateName(cand, primary);
        name.appendChild(nameText);
        const nameParty = document.createElement("span");
        nameParty.className = `bm-nbc-name-party ${getPartyClass(cand)}`;
        const partyLabel = getPartyLabel(cand);
        nameParty.innerText = partyLabel === "NP" ? "NP" : (partyLabel.charAt(0) || "I");
        name.appendChild(nameParty);
        const evText = getCandidateElectoralVoteBadge(cand, district, live, isWinner, primary);
        if(evText){
            const evBadge = document.createElement("span");
            evBadge.className = "bm-nbc-ev-badge";
            evBadge.innerText = evText;
            name.appendChild(evBadge);
        }
        if(cand.incumbent === true){
            const inc = document.createElement("span");
            inc.className = "bm-nbc-incumbent";
            inc.innerText = "INCUMBENT";
            name.appendChild(inc);
        }
        const delegates = primary ? getCandidateDelegateCount(cand, district, live) : null;
        if(delegates !== null){
            const del = document.createElement("span");
            del.className = "bm-nbc-delegates";
            del.innerText = `${formatNumber(delegates)} DEL`;
            name.appendChild(del);
        }
        row.appendChild(name);

        const votes = candidateVotes(cand, live);
        const total = districtVotes(district, live);
        const pct = total > 0 ? (votes / total) * 100 : 0;

        const voteNode = document.createElement("div");
        voteNode.className = "bm-nbc-votes";
        voteNode.innerText = formatNumber(votes);
        row.appendChild(voteNode);

        const pctWrap = document.createElement("div");
        pctWrap.className = "bm-nbc-pct-wrap";
        const pctNode = document.createElement("div");
        pctNode.className = "bm-nbc-pct";
        pctNode.innerText = `${formatPercent(pct)}%`;
        pctWrap.appendChild(pctNode);

        const barTrack = document.createElement("div");
        barTrack.className = "bm-nbc-bar-track";
        const bar = document.createElement("div");
        bar.className = "bm-nbc-bar";
        bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        try { bar.style.backgroundColor = stringifyColour(getCandidateColour(cand)); } catch(err) {}
        barTrack.appendChild(bar);
        pctWrap.appendChild(barTrack);
        row.appendChild(pctWrap);

        if(isWinner){
            const check = document.createElement("span");
            check.className = "bm-nbc-check";
            check.textContent = "\u2714";
            name.appendChild(check);
            const rowStatusText = primary ? primaryStatusText : "Projected Winner";
            if(rowStatusText){
                const status = document.createElement("span");
                status.className = "bm-nbc-primary-status";
                status.innerText = rowStatusText;
                name.appendChild(status);
            }
        }

        return row;
    };

    const captureCandidateRowPositions = () => {
        const positions = {};
        if(!tooltipComponents.entries) return positions;
        Array.from(tooltipComponents.entries.children).forEach((row, index) => {
            if(!row.getAttribute) return;
            const key = row.getAttribute("data-candidate-key");
            if(!key) return;
            positions[key] = {
                top: row.getBoundingClientRect().top,
                index,
                barWidth: row.querySelector(".bm-nbc-bar") ? row.querySelector(".bm-nbc-bar").style.width : "",
                votesText: row.querySelector(".bm-nbc-votes") ? row.querySelector(".bm-nbc-votes").innerText : "",
                pctText: row.querySelector(".bm-nbc-pct") ? row.querySelector(".bm-nbc-pct").innerText : ""
            };
        });
        return positions;
    };

    const animateCandidateRows = (previousPositions) => {
        if(!previousPositions || !tooltipComponents.entries) return;
        Array.from(tooltipComponents.entries.children).forEach((row, index) => {
            if(!row.getAttribute) return;
            const key = row.getAttribute("data-candidate-key");
            if(!key || !previousPositions[key]) return;
            const previous = previousPositions[key];

            const oldTop = previous.top;
            const newTop = row.getBoundingClientRect().top;
            const deltaY = oldTop - newTop;
            const bar = row.querySelector(".bm-nbc-bar");
            const votes = row.querySelector(".bm-nbc-votes");
            const pct = row.querySelector(".bm-nbc-pct");
            const targetBarWidth = bar ? bar.style.width : "";
            const valueChanged = (votes && previous.votesText !== votes.innerText) || (pct && previous.pctText !== pct.innerText);

            if(previous.index > index) row.classList.add("is-gaining-position");
            row.style.transition = "none";
            if(Math.abs(deltaY) >= 1) row.style.transform = `translateY(${deltaY}px)`;
            if(bar && previous.barWidth && previous.barWidth !== targetBarWidth){
                bar.style.transition = "none";
                bar.style.width = previous.barWidth;
            }
            row.getBoundingClientRect();
            requestAnimationFrame(() => {
                row.style.transition = "transform 720ms cubic-bezier(.16,.84,.24,1), background-color 460ms ease, box-shadow 460ms ease";
                row.style.transform = "translateY(0)";
                if(bar){
                    bar.style.transition = "width 760ms cubic-bezier(.16,.84,.24,1), background-color 420ms ease";
                    bar.style.width = targetBarWidth;
                }
                if(valueChanged){
                    row.classList.remove("is-value-updated");
                    row.getBoundingClientRect();
                    row.classList.add("is-value-updated");
                }
            });
        });
    };

    const appendHiddenCandidateCount = (count) => {
        if(count <= 0) return;
        const more = document.createElement("div");
        more.className = "bm-nbc-more-candidates";
        more.innerText = `+ ${count} MORE CANDIDATE${count === 1 ? "" : "S"}`;
        tooltipComponents.entries.appendChild(more);
    };

    const createCandidateTable = (district, live, primary, primaryStatusText) => {
        const stats = getRaceStats(district, live);
        const maxRows = primary ? 4 : 3;
        let winner = null;
        if(district._countyView !== true){
            const flaggedWinners = stats.cands.filter(candidateHasWinFlag);
            if(flaggedWinners.length > 0){
                winner = new Set(flaggedWinners);
            } else if(district.pW === true || district.projected === true || district.final === true || !live){
                const advanceCount = primary ? Math.max(1, Math.min(stats.cands.length, safeNum(district._primaryAdvanceCount, 1))) : 1;
                winner = primary ? new Set(stats.cands.slice(0, advanceCount)) : stats.leader;
            }
        }
        stats.cands.slice(0, maxRows).forEach(candidate => {
            try {
                tooltipComponents.entries.appendChild(createTooltipEntry(candidate, district, live, winner, primary, primaryStatusText));
            } catch(err) {
                tooltipComponents.entries.appendChild(createFallbackTooltipEntry(candidate, district, live, winner, primary, primaryStatusText));
            }
        });
        appendHiddenCandidateCount(stats.cands.length - maxRows);
    };

    const getPrimaryDisplayCands = (cands, live) => {
        return (cands || []).map(cand => {
            const clone = Object.assign({}, cand);
            if(live && getCandidateLiveVotes(clone) === undefined) clone.currentVotes = 0;
            return clone;
        });
    };

    const buildPartyPrimaryBlock = (label, className, cands, live, parentDistrict, sourceBlock) => {
        if(!cands || cands.length === 0) return;
        const blockParty = getPrimaryBlockParty({ label, className });
        const displayCands = getPrimaryDisplayCands(cands, live);
        const rawDelegateTotal = getPrimaryDelegateTotal(blockParty, sourceBlock, parentDistrict);
        const candidateDelegateTotal = displayCands.reduce((sum, cand) => {
            return sum + safeNum(firstDelegateValue(cand.delegates, cand.delegateCount, cand.pledgedDelegates, cand.primaryDelegates), 0);
        }, 0);
        const delegateTotal = Math.max(safeNum(rawDelegateTotal, 0), candidateDelegateTotal);
        const hasDelegateTotal = delegateTotal > 0;
        const header = document.createElement("div");
        header.className = `bm-nbc-primary-header ${className}`;
        const headerLabel = document.createElement("span");
        headerLabel.innerText = label;
        header.appendChild(headerLabel);
        if(tooltipComponents.properties.electionType === "president" && hasDelegateTotal){
            const delegateBadge = document.createElement("span");
            delegateBadge.className = "bm-nbc-primary-meta-badge";
            delegateBadge.innerText = `${formatNumber(delegateTotal)} DELEGATES`;
            header.appendChild(delegateBadge);
        }
        if(tooltipComponents.properties.electionType === "president" && blockParty === "R" && isWinnerTakeAllPrimary(blockParty, sourceBlock, parentDistrict)){
            const wtaBadge = document.createElement("span");
            wtaBadge.className = "bm-nbc-primary-meta-badge bm-nbc-primary-wta";
            wtaBadge.innerText = "WTA";
            header.appendChild(wtaBadge);
        }
        tooltipComponents.entries.appendChild(header);

        const total = displayCands.reduce((sum, c) => sum + candidateVotes(c, live), 0);
        const finalTotal = cands.reduce((sum, c) => sum + candidateVotes(c, false), 0);
        const fullyReported = finalTotal > 0 && total >= finalTotal;
        const parentProjected = parentDistrict && (parentDistrict.pW === true || parentDistrict.projected === true || parentDistrict.final === true);
        const independentOnlyBlock = String(label || "").toLowerCase().indexOf("independent") !== -1 || String(className || "").toLowerCase().indexOf("primary-ind") !== -1;
        const fakeDistrict = {
            totalVotes: finalTotal,
            totalCurrVotes: total,
            cands: displayCands,
            pW: independentOnlyBlock ? false : (displayCands.some(candidateHasWinFlag) || parentProjected || (!live && finalTotal > 0) || (live && fullyReported))
        };
        const primaryInfo = getPrimaryAdvanceInfo(activeMap, parentDistrict || {});
        const statusText = independentOnlyBlock ? "" : (blockParty === "N" ? "Advance to General" : "Projected Winner");
        const flaggedCount = displayCands.filter(candidateHasWinFlag).length;
        fakeDistrict._primaryAdvanceCount = independentOnlyBlock ? 0 : (blockParty === "N" ? Math.max(1, flaggedCount || primaryInfo.topCount || 1) : Math.max(1, flaggedCount || 1));
        fakeDistrict._primaryDelegateTotal = hasDelegateTotal ? delegateTotal : rawDelegateTotal;
        createCandidateTable(fakeDistrict, live, true, statusText);
    };

    const getPrimaryBlockParty = (block) => {
        const label = String(block && block.label || "").toLowerCase();
        const className = String(block && block.className || "").toLowerCase();
        if(label.indexOf("democratic") !== -1 || className.indexOf("dem") !== -1) return "D";
        if(label.indexOf("republican") !== -1 || className.indexOf("rep") !== -1) return "R";
        return "N";
    };

    const primaryPartyTotal = (block, live) => {
        if(!block || !block.cands) return 0;
        return getPrimaryDisplayCands(block.cands, live).reduce((sum, cand) => sum + candidateVotes(cand, live), 0);
    };

    const getEligibleVoterTotal = (district) => {
        const objects = [
            district,
            getStateObj(tooltipComponents.properties && tooltipComponents.properties.districtId),
            getStateObj(activeMap)
        ].filter(Boolean);
        const keys = [
            "eligibleVoters",
            "eligibleVoterTotal",
            "eligiblePopulation",
            "votingPopulation",
            "votingPop",
            "voterPopulation",
            "votingAgePopulation",
            "registeredVoters",
            "registered",
            "registeredTotal",
            "registeredVoterTotal",
            "totalRegisteredVoters",
            "totalRegistered",
            "votersRegistered",
            "namesOnChecklist",
            "checklistTotal",
            "checklist",
            "voterChecklist",
            "voterRegistrationTotal"
        ];

        for(let i = 0; i < objects.length; i++){
            for(let j = 0; j < keys.length; j++){
                const direct = firstFinite(objects[i][keys[j]]);
                if(direct !== null && direct > 0) return direct;
                const nested = firstFinite(getNestedValue(objects[i], ["registration", keys[j]]), getNestedValue(objects[i], ["voters", keys[j]]));
                if(nested !== null && nested > 0) return nested;
            }
        }
        return null;
    };

    const appendPrimaryTurnoutFooter = (district, live) => {
        const blocks = getPrimaryBlocks(district);
        const totals = { D: 0, R: 0, N: 0 };
        const hasBlock = { D: false, R: false, N: false };
        blocks.forEach(block => {
            const party = getPrimaryBlockParty(block);
            hasBlock[party] = true;
            totals[party] += primaryPartyTotal(block, live);
        });
        const primaryInfo = getPrimaryAdvanceInfo(activeMap, district);
        const nonpartisanTotal = totals.N > 0 ? totals.N : totals.D + totals.R;
        const totalVotes = Math.max(0, totals.D + totals.R + totals.N);
        const rows = [];

        if(primaryInfo.nonpartisan || (!hasBlock.D && !hasBlock.R)){
            rows.push({ party: "N", label: "Turnout", votes: nonpartisanTotal, shareBase: nonpartisanTotal });
        } else {
            if(hasBlock.D) rows.push({ party: "D", label: "Democratic Turnout", votes: totals.D, shareBase: totalVotes });
            if(hasBlock.R) rows.push({ party: "R", label: "Republican Turnout", votes: totals.R, shareBase: totalVotes });
            if(hasBlock.N) rows.push({ party: "N", label: "Nonpartisan Turnout", votes: totals.N, shareBase: totalVotes });
        }
        if(rows.length === 0) return;
        rows.sort((a, b) => b.votes - a.votes);
        const footer = document.createElement("div");
        footer.className = "bm-nbc-turnout-grid";
        rows.forEach(row => {
            const box = document.createElement("div");
            box.className = `bm-nbc-turnout-box turnout-${String(row.party).toLowerCase()}`;

            const label = document.createElement("span");
            label.className = "bm-nbc-turnout-party";
            label.innerText = row.label;
            box.appendChild(label);

            const votes = document.createElement("span");
            votes.className = "bm-nbc-turnout-votes";
            votes.innerText = formatNumber(row.votes);
            box.appendChild(votes);

            const pct = document.createElement("span");
            pct.className = "bm-nbc-turnout-share";
            const share = row.shareBase > 0 ? (row.votes / row.shareBase) * 100 : 0;
            pct.innerText = `${formatPercent(share)}%`;
            box.appendChild(pct);

            footer.appendChild(box);
        });
        const eligibleVoters = getEligibleVoterTotal(district);
        if(eligibleVoters !== null && eligibleVoters > 0){
            const box = document.createElement("div");
            box.className = "bm-nbc-turnout-box bm-nbc-state-turnout";

            const label = document.createElement("span");
            label.className = "bm-nbc-turnout-party";
            label.innerText = "State Turnout";
            box.appendChild(label);

            const votes = document.createElement("span");
            votes.className = "bm-nbc-turnout-votes";
            votes.innerText = `${formatNumber(totalVotes)} / ${formatNumber(eligibleVoters)}`;
            box.appendChild(votes);

            const pct = document.createElement("span");
            pct.className = "bm-nbc-turnout-share";
            pct.innerText = `${formatPercent((totalVotes / eligibleVoters) * 100)}%`;
            box.appendChild(pct);

            footer.appendChild(box);
        }
        tooltipComponents.entries.appendChild(footer);
    };

    const getPrimaryBlocks = (district) => {
        const blocks = [];
        const used = [];
        const getBlockCands = (value) => {
            if(!value) return null;
            if(Array.isArray(value.cands)) return value.cands;
            if(Array.isArray(value.candidates)) return value.candidates.map(c => {
                const clone = Object.assign({}, c);
                if(clone.votes === undefined && clone.totVotes !== undefined) clone.votes = clone.totVotes;
                if(clone.currentVotes === undefined && clone.currentTotVotes !== undefined) clone.currentVotes = clone.currentTotVotes;
                return clone;
            });
            return null;
        };
        const addBlock = (label, className, cands, party, source) => {
            if(!cands || cands.length === 0 || used.indexOf(cands) !== -1) return;
            used.push(cands);
            blocks.push({
                label,
                className,
                source,
                cands: cands.map(c => party ? Object.assign({ party }, c) : Object.assign({}, c))
            });
        };
        const demCands = getBlockCands(district.dem);
        const repCands = getBlockCands(district.rep);
        if(demCands && demCands.length !== 0){
            addBlock("DEMOCRATIC PRIMARY", "primary-dem", demCands, "D", district.dem);
        }
        if(repCands && repCands.length !== 0){
            addBlock("REPUBLICAN PRIMARY", "primary-rep", repCands, "R", district.rep);
        }
        const directCands = getBlockCands(district);
        if(blocks.length === 0 && directCands && directCands.length !== 0){
            const primaryInfo = getPrimaryAdvanceInfo(activeMap, district);
            if(primaryInfo.nonpartisan) addBlock("NONPARTISAN PRIMARY", "primary-nonpartisan", directCands, "", district);
            else addBlock("INDEPENDENT CANDIDATES", "primary-ind", directCands, "I", district);
        }
        if(blocks.length === 0){
            Object.keys(district || {}).forEach(key => {
                const value = district[key];
                const cands = getBlockCands(value);
                if(!cands || cands.length === 0) return;
                const normalizedKey = normalizeRuleText(key);
                if(normalizedKey.indexOf("dem") !== -1){
                    addBlock("DEMOCRATIC PRIMARY", "primary-dem", cands, "D", value);
                } else if(normalizedKey.indexOf("rep") !== -1){
                    addBlock("REPUBLICAN PRIMARY", "primary-rep", cands, "R", value);
                } else if(normalizedKey.indexOf("ind") !== -1){
                    addBlock("INDEPENDENT CANDIDATES", "primary-ind", cands, "I", value);
                } else {
                    const label = normalizedKey.indexOf("runoff") !== -1 ? "NONPARTISAN RUNOFF" : "NONPARTISAN PRIMARY";
                    addBlock(label, "primary-nonpartisan", cands, "", value);
                }
            });
        }
        return blocks;
    };

    const isPrimaryDistrict = (district) => {
        if(!district) return false;
        if(district.dem || district.rep || district.ind || district.nonpartisan) return true;
        const text = normalizeRuleText(`${district.category || ""} ${district.type || ""} ${district.electionType || ""} ${district.name || ""}`);
        return text.indexOf("primary") !== -1;
    };

    const getStatewideRaceTitle = (electionType, districtId, countyView, currentDistrict) => {
        if(countyView) return currentDistrict ? currentDistrict.name : getSubdivisionLabel(activeMap);
        const stateObj = getStateObj(districtId);
        const stateName = stateObj ? stateObj.name : String(districtId).toUpperCase();
        if(electionType === "president") return `${stateName} Presidential`;
        if(electionType === "usSenate") return `${stateName} U.S. Senate`;
        if(electionType === "governor") return `${stateName} Governor`;
        return stateName;
    };

    const getHouseWinnerParty = (district, live) => {
        if(!district || !district.cands || district.cands.length === 0) return null;
        const cands = district.cands.slice().sort((a, b) => {
            const av = candidateVotes(a, live);
            const bv = candidateVotes(b, live);
            return bv - av;
        });
        const winner = cands[0];
        if(!winner) return null;
        if(winner.party === "I") return "I";
        return getPartyKey(winner).charAt(0);
    };

    const isHouseDistrictProjected = (district, live) => {
        if(!district) return false;
        if(!live) return true;
        if(district.pW === true || district.projected === true || district.final === true) return true;
        return Array.isArray(district.cands) && district.cands.some(candidateHasWinFlag);
    };

    const getHouseIncumbentParty = (district) => {
        if(!district || !district.cands) return null;
        const incumbent = district.cands.filter(cand => cand.incumbent === true)[0];
        if(!incumbent) return null;
        if(incumbent.party === "I") return "I";
        return getPartyKey(incumbent).charAt(0);
    };

    const getHouseSeatSummary = (districts, live, calledOnly) => {
        const summary = {
            seats: { D: 0, R: 0, I: 0 },
            flips: { D: 0, R: 0, I: 0 },
            totalFlips: 0,
            totalSeats: 0,
            votes: { D: 0, R: 0, I: 0 }
        };

        districts.forEach(district => {
            if(district && district.cands){
                district.cands.forEach(cand => {
                    summary.votes[getHouseVotePartyKey(cand)] += candidateVotes(cand, live);
                });
            }
            if(calledOnly && !isHouseDistrictProjected(district, live)) return;
            const winnerParty = getHouseWinnerParty(district, live);
            if(!winnerParty) return;

            if(summary.seats[winnerParty] === undefined) summary.seats.I++;
            else summary.seats[winnerParty]++;
            summary.totalSeats++;

            const incumbentParty = getHouseIncumbentParty(district);
            if(incumbentParty && incumbentParty !== winnerParty){
                if(summary.flips[winnerParty] === undefined) summary.flips.I++;
                else summary.flips[winnerParty]++;
                summary.totalFlips++;
            }
        });

        return summary;
    };

    const appendHouseMetricBadge = (text, className) => {
        const badge = document.createElement("span");
        badge.className = `bm-nbc-badge ${className || ""}`;
        badge.innerText = text;
        return badge;
    };

    const appendHousePrimaryComposition = (houseState, live) => {
        const districts = houseState && houseState.districts ? houseState.districts : [];
        const turnout = { D: 0, R: 0, I: 0 };
        let primaryRaces = 0;

        districts.forEach(district => {
            hydrateHouseDistrictLiveVotes(district, live);
            if(!isPrimaryDistrict(district)) return;
            primaryRaces++;
            turnout.D += primaryPartyTotal(district.dem, live);
            turnout.R += primaryPartyTotal(district.rep, live);
            if(district.cands) turnout.I += primaryPartyTotal({ cands: district.cands }, live);
        });

        tooltipComponents.reporting.innerText = "PRIMARY RESULTS";
        tooltipComponents.reporting.style.display = "block";

        const metaLine = document.createElement("div");
        metaLine.className = "bm-nbc-meta-line";
        const seatNode = document.createElement("span");
        seatNode.className = "bm-nbc-margin";
        seatNode.innerText = `${primaryRaces}/${districts.length} HOUSE PRIMARIES`;
        metaLine.appendChild(seatNode);
        tooltipComponents.meta.appendChild(metaLine);

        const rows = [
            { party: "D", name: "Democratic Turnout", votes: turnout.D },
            { party: "R", name: "Republican Turnout", votes: turnout.R },
            { party: "I", name: "Nonpartisan Turnout", votes: turnout.I }
        ].filter(row => row.votes > 0 || row.party !== "I")
            .sort((a, b) => b.votes - a.votes);

        const maxVotes = Math.max(1, ...rows.map(row => row.votes));
        rows.forEach(rowInfo => {
            const row = document.createElement("div");
            row.className = "bm-nbc-row bm-house-row";
            row.setAttribute("data-candidate-key", `house-primary:${rowInfo.party}`);

            const party = document.createElement("div");
            party.className = `bm-nbc-party party-${rowInfo.party.toLowerCase()}`;
            party.innerText = rowInfo.party;
            row.appendChild(party);

            const name = document.createElement("div");
            name.className = "bm-nbc-name";
            name.innerText = rowInfo.name;
            row.appendChild(name);

            const votes = document.createElement("div");
            votes.className = "bm-nbc-votes";
            votes.innerText = formatNumber(rowInfo.votes);
            row.appendChild(votes);

            const pctWrap = document.createElement("div");
            pctWrap.className = "bm-nbc-pct-wrap";
            const pctNode = document.createElement("div");
            pctNode.className = "bm-nbc-pct";
            pctNode.innerText = "votes";
            pctWrap.appendChild(pctNode);
            const barTrack = document.createElement("div");
            barTrack.className = "bm-nbc-bar-track";
            const bar = document.createElement("div");
            bar.className = "bm-nbc-bar";
            bar.style.width = `${Math.max(4, Math.min(100, (rowInfo.votes / maxVotes) * 100))}%`;
            const colour = rowInfo.party === "D" ? { h: 210, s: 100, l: 45 } : (rowInfo.party === "R" ? { h: 359, s: 100, l: 48 } : { h: 272, s: 78, l: 48 });
            bar.style.backgroundColor = stringifyColour(colour);
            barTrack.appendChild(bar);
            pctWrap.appendChild(barTrack);
            row.appendChild(pctWrap);
            tooltipComponents.entries.appendChild(row);
        });
    };

    const appendHouseComposition = (houseState, live) => {
        const districts = houseState && houseState.districts ? houseState.districts : [];
        const called = { D: 0, R: 0, I: 0 };
        const leading = { D: 0, R: 0, I: 0 };

        districts.forEach(district => {
            hydrateHouseDistrictLiveVotes(district, live);
            const party = getHouseWinnerParty(district, live);
            if(!party) return;
            if(leading[party] === undefined) leading.I++;
            else leading[party]++;

            if(isHouseDistrictProjected(district, live)){
                if(called[party] === undefined) called.I++;
                else called[party]++;
            }
        });

        const totalCalled = called.D + called.R + called.I;
        tooltipComponents.reporting.innerText = `${totalCalled}/${districts.length} SEATS CALLED`;
        tooltipComponents.reporting.style.display = "block";

        const voteSummary = getHouseSeatSummary(districts, live, false);
        const flipSummary = getHouseSeatSummary(districts, live, true);

        if(flipSummary.totalFlips > 0){
            const metaLine = document.createElement("div");
            metaLine.className = "bm-nbc-meta-line";
            const gainOrder = ["D", "R", "I"]
                .map(party => ({ party, gains: safeNum(flipSummary.flips[party]) }))
                .sort((a, b) => b.gains - a.gains);
            const topGain = gainOrder[0];
            const runnerGain = gainOrder[1] ? gainOrder[1].gains : 0;
            if(topGain && topGain.gains > 0){
                const netGain = topGain.gains - runnerGain;
                const label = netGain > 0
                    ? `${topGain.party} +${netGain} NET GAIN`
                    : `${topGain.party} FLIPPED ${topGain.gains}`;
                metaLine.appendChild(appendHouseMetricBadge(label, `bm-house-net-gain party-${topGain.party.toLowerCase()}`));
            }
            tooltipComponents.meta.appendChild(metaLine);
        }

        const rows = [
            { party: "D", name: "Democrats", seats: called.D, leading: leading.D, votes: voteSummary.votes.D, gains: flipSummary.flips.D },
            { party: "R", name: "Republicans", seats: called.R, leading: leading.R, votes: voteSummary.votes.R, gains: flipSummary.flips.R },
            { party: "I", name: "Independents", seats: called.I, leading: leading.I, votes: voteSummary.votes.I, gains: flipSummary.flips.I }
        ].sort((a, b) => {
            if(b.seats !== a.seats) return b.seats - a.seats;
            if(b.leading !== a.leading) return b.leading - a.leading;
            return b.votes - a.votes;
        });

        const header = document.createElement("div");
        header.className = "bm-house-summary-header";
        ["Party", "Called", "Leading", "Votes"].forEach(text => {
            const span = document.createElement("span");
            span.innerText = text;
            header.appendChild(span);
        });
        tooltipComponents.entries.appendChild(header);

        rows.forEach(rowInfo => {
            const row = document.createElement("div");
            row.className = "bm-house-summary-row";
            row.setAttribute("data-candidate-key", `house:${rowInfo.party}`);

            const party = document.createElement("div");
            party.className = `bm-nbc-party party-${rowInfo.party.toLowerCase()} bm-house-summary-party`;
            party.innerText = rowInfo.party;
            row.appendChild(party);

            const name = document.createElement("div");
            name.className = "bm-house-summary-name";
            const nameText = document.createElement("span");
            nameText.innerText = rowInfo.name;
            name.appendChild(nameText);
            if(rowInfo.gains > 0){
                const gainNode = document.createElement("span");
                gainNode.className = `bm-house-party-gain party-${rowInfo.party.toLowerCase()}`;
                gainNode.innerText = `+${formatNumber(rowInfo.gains)} GAINED`;
                name.appendChild(gainNode);
            }
            row.appendChild(name);

            const calledNode = document.createElement("div");
            calledNode.className = "bm-house-summary-number";
            calledNode.innerText = formatNumber(rowInfo.seats);
            row.appendChild(calledNode);

            const leadingNode = document.createElement("div");
            leadingNode.className = "bm-house-summary-number";
            leadingNode.innerText = formatNumber(rowInfo.leading);
            row.appendChild(leadingNode);

            const votesNode = document.createElement("div");
            votesNode.className = "bm-house-summary-votes";
            votesNode.innerText = formatNumber(rowInfo.votes);
            row.appendChild(votesNode);

            tooltipComponents.entries.appendChild(row);
        });
    };

    const getCountyDistrict = (actualStDistrict, districtId, live) => {
        const origCounty = actualStDistrict.counties.filter(candCounty => {
            const truncatedName = candCounty.name.substring(0, candCounty.name.lastIndexOf(" "));
            const replacedName = candCounty.name.toLowerCase().replace(/ /g, "_").replace(/\./g, "");
            const truncatedReplacedName = truncatedName.toLowerCase().replace(/ /g, "_").replace(/\./g, "");
            return (replacedName === districtId || truncatedReplacedName === districtId);
        })[0];
        if(!origCounty) return undefined;

        const stateElectData = allStElectData.filter(electData => (electData.id === activeMap))[0];
        let totalCurrVotes = 0;
        let totalVotes = 0;

        const countyElectData = stateElectData && stateElectData.counties
            ? stateElectData.counties.filter(candCountyData => (candCountyData.name === origCounty.name))[0]
            : null;

        const newCounty = {
            name: origCounty.name,
            _countyView: true,
            _origCounty: origCounty,
            _countyElectData: countyElectData,
            _stateElectData: stateElectData,
            cands: origCounty.cands.map(candObj => {
                const newCandObj = Object.assign({}, candObj);
                if(!live) {
                    newCandObj.currentVotes = newCandObj.votes;
                } else {
                    newCandObj.currentVotes = countyElectData ? (newCandObj.votes * candObj.updates[countyElectData.indx]) : 0;
                }
                totalCurrVotes += safeNum(newCandObj.currentVotes);
                totalVotes += safeNum(newCandObj.votes);
                return newCandObj;
            })
        };
        newCounty.totalCurrVotes = totalCurrVotes;
        newCounty.totalVotes = totalVotes;
        return newCounty;
    };

    const updateTooltip = (electionType, districtId, force, live, countyView) => {
        if(tooltipComponents.properties.visible === false) return;
        if(electionType === tooltipComponents.properties.electionType && districtId === tooltipComponents.properties.districtId && force !== true) return;

        tooltipComponents.properties.electionType = electionType;
        tooltipComponents.properties.districtId = districtId;

        let currentResults = resultProxies[electionType];
        let currentDistrict = currentResults[districtId];
        let parentDistrict = null;
        let displayDistrictId = districtId;

        if(electionType === "usHouse" && String(districtId).indexOf("__") !== -1){
            const parts = String(districtId).toLowerCase().split("__");
            parentDistrict = currentResults[parts[0]];
            currentDistrict = parentDistrict && parentDistrict.districts ? parentDistrict.districts[safeNum(parts[1], -1)] : undefined;
            if(currentDistrict){
                currentDistrict._betterMapsStateId = parts[0];
                currentDistrict._betterMapsDistrictIndex = safeNum(parts[1], 0);
                hydrateHouseDistrictLiveVotes(currentDistrict, live);
                displayDistrictId = parts[0];
            }
        }

        if(countyView){
            if(isShiftMunicipalityState(activeMap)){
                currentDistrict = getMunicipalitySyntheticDistrict(getShiftMunicipalityId(districtId), electionType, live);
                parentDistrict = currentDistrict;
            } else {
                parentDistrict = currentResults[activeMap];
                currentDistrict = parentDistrict ? getCountyDistrict(parentDistrict, districtId, live) : undefined;
            }
        }

        if(electionType === "president" && !live && currentDistrict === undefined){
            const stateObj = getStateObj(districtId);
            const filteredDemStates = presPrimaryDemArray.states.filter(stateObj2 => (stateObj2.name === stateObj.name));
            const filteredRepStates = presPrimaryRepArray.states.filter(stateObj2 => (stateObj2.name === stateObj.name));
            if(filteredDemStates.length !== 0){
                const demState = filteredDemStates[0];
                const repState = filteredRepStates[0] || { candidates: [] };
                currentDistrict = {
                    dem: { delegates: firstDelegateValue(demState.delegates, demState.delegateCount, demState.totalDelegates), cands: demState.candidates.map(cand => { const c = Object.assign({}, cand); c.votes = c.totVotes; c.party = "D"; return c; }) },
                    rep: { delegates: firstDelegateValue(repState.delegates, repState.delegateCount, repState.totalDelegates), cands: (repState.candidates || []).map(cand => { const c = Object.assign({}, cand); c.votes = c.totVotes; c.party = "R"; return c; }) }
                };
            }
        }

        const previousCandidateRows = captureCandidateRowPositions();
        clearNode(tooltipComponents.entries);
        clearNode(tooltipComponents.meta);
        setHeaderBattleground(false);
        tooltipComponents.noElection.setAttribute("style", "display: none;");
        tooltipComponents.notCounting.setAttribute("style", "display: none;");
        tooltipComponents.electors.setAttribute("style", "display: none;");

        if(electionType === "usHouse" && String(districtId).indexOf("__") !== -1 && currentDistrict){
            const stateObj = getStateObj(displayDistrictId);
            const stateName = stateObj ? stateObj.name : String(displayDistrictId).toUpperCase();
            tooltipComponents.title.innerText = getHouseDistrictTitle(stateName, currentDistrict, parentDistrict);
        } else {
            tooltipComponents.title.innerText = getStatewideRaceTitle(electionType, districtId, countyView, currentDistrict);
        }

        if(currentDistrict === undefined){
            tooltipComponents.reporting.innerText = "";
            tooltipComponents.noElection.removeAttribute("style");
            return;
        }

        if(electionType === "usHouse" && live && !hasHouseTooltipVoteDump(currentDistrict, displayDistrictId, live)){
            tooltipComponents.reporting.innerText = "WAITING FOR RESULTS";
            tooltipComponents.reporting.style.display = "block";
            tooltipComponents.notCounting.removeAttribute("style");
            return;
        }

        if(electionType === "usHouse" && currentDistrict.districts !== undefined){
            if(currentDistrict.districts.some(isPrimaryDistrict)) appendHousePrimaryComposition(currentDistrict, live);
            else appendHouseComposition(currentDistrict, live);
            return;
        }

        if(currentDistrict.cands === undefined){
            tooltipComponents.reporting.innerText = "PRIMARY RESULTS";
            tooltipComponents.reporting.style.display = "block";
            appendPrimaryRuleMeta(electionType, currentDistrict, districtId, live, countyView);
            getPrimaryBlocks(currentDistrict).forEach(block => buildPartyPrimaryBlock(block.label, block.className, block.cands, live, currentDistrict, block.source));
            appendPrimaryTurnoutFooter(currentDistrict, live);
            return;
        }

        if(isPrimaryDistrict(currentDistrict)){
            tooltipComponents.reporting.innerText = "PRIMARY RESULTS";
            tooltipComponents.reporting.style.display = "block";
            appendPrimaryRuleMeta(electionType, currentDistrict, districtId, live, countyView);
            getPrimaryBlocks(currentDistrict).forEach(block => buildPartyPrimaryBlock(block.label, block.className, block.cands, live, currentDistrict, block.source));
            appendPrimaryTurnoutFooter(currentDistrict, live);
            return;
        }

        const totalVotes = districtVotes(currentDistrict, live);
        const percentReportedRaw = currentDistrict.totalVotes > 0 ? Math.round((safeNum(currentDistrict.totalCurrVotes) / safeNum(currentDistrict.totalVotes)) * 100) : 0;
        const percentReported = Math.max(0, Math.min(100, percentReportedRaw));

        if(!live && !countyView){
            tooltipComponents.reporting.innerText = "FINAL / PROJECTED";
        } else {
            tooltipComponents.reporting.innerText = `${percentReported}% EST. REPORTING`;
        }
        tooltipComponents.reporting.style.display = "block";

        if(electionType === "president" && !countyView && !(live && currentDistrict.totalCurrVotes === 0)){
            const stateObj = getStateObj(districtId);
            if(stateObj){
                const proportional = isProportionalElectoralCollegeState(districtId, currentDistrict);
                tooltipComponents.electors.innerText = `${stateObj.electoralNum} Electoral Votes${proportional ? " - Proportional EC" : ""}`;
                tooltipComponents.electors.removeAttribute("style");
            }
        }

        if(live && safeNum(currentDistrict.totalCurrVotes) === 0){
            tooltipComponents.notCounting.removeAttribute("style");
        } else {
            currentDistrict._betterMapsFlipped = isFlippedSeat(electionType, displayDistrictId, currentDistrict, live, countyView);
            appendMeta(electionType, currentDistrict, displayDistrictId, live, countyView, parentDistrict);
            createCandidateTable(currentDistrict, live, false);
            appendBottomIndicators();
            animateCandidateRows(previousCandidateRows);
        }
    };

    const createTooltip = () => {
        tooltipComponents.properties = { visible: false, targetDistrict: null, electionType: "", districtId: "" };

        tooltipComponents.network = document.createElement("div");
        tooltipComponents.network.setAttribute("id", "better-maps-tooltip-network");
        tooltipComponents.networkLabel = document.createElement("span");
        tooltipComponents.networkLabel.setAttribute("id", "better-maps-tooltip-network-label");
        tooltipComponents.networkLabel.innerText = "DECISION DESK";
        tooltipComponents.network.appendChild(tooltipComponents.networkLabel);
        tooltipComponents.battlegroundHeader = document.createElement("span");
        tooltipComponents.battlegroundHeader.setAttribute("id", "better-maps-tooltip-battleground");
        tooltipComponents.battlegroundHeader.style.setProperty("display", "none", "important");
        tooltipComponents.battlegroundHeader.innerText = "BATTLEGROUND";
        tooltipComponents.network.appendChild(tooltipComponents.battlegroundHeader);
        tooltipDiv.appendChild(tooltipComponents.network);

        tooltipComponents.header = document.createElement("div");
        tooltipComponents.header.setAttribute("id", "better-maps-tooltip-header");
        tooltipDiv.appendChild(tooltipComponents.header);

        tooltipComponents.title = document.createElement("div");
        tooltipComponents.title.setAttribute("id", "better-maps-tooltip-title");
        tooltipComponents.header.appendChild(tooltipComponents.title);

        tooltipComponents.reporting = document.createElement("div");
        tooltipComponents.reporting.setAttribute("id", "better-maps-tooltip-reporting");
        tooltipComponents.header.appendChild(tooltipComponents.reporting);

        tooltipComponents.meta = document.createElement("div");
        tooltipComponents.meta.setAttribute("id", "better-maps-tooltip-meta");
        tooltipDiv.appendChild(tooltipComponents.meta);

        tooltipComponents.entries = document.createElement("div");
        tooltipComponents.entries.setAttribute("id", "better-maps-tooltip-entries");
        tooltipDiv.appendChild(tooltipComponents.entries);

        tooltipComponents.noElection = document.createElement("div");
        tooltipComponents.noElection.innerText = "No election data available.";
        tooltipComponents.noElection.setAttribute("id", "better-maps-tooltip-no-election");
        tooltipComponents.noElection.setAttribute("style", "display: none;");
        tooltipDiv.appendChild(tooltipComponents.noElection);

        tooltipComponents.notCounting = document.createElement("div");
        tooltipComponents.notCounting.innerText = "Waiting for results...";
        tooltipComponents.notCounting.setAttribute("id", "better-maps-tooltip-not-counted");
        tooltipComponents.notCounting.setAttribute("style", "display: none;");
        tooltipDiv.appendChild(tooltipComponents.notCounting);

        tooltipComponents.electors = document.createElement("div");
        tooltipComponents.electors.setAttribute("id", "better-maps-tooltip-electors");
        tooltipComponents.electors.setAttribute("style", "display: none;");
        tooltipDiv.appendChild(tooltipComponents.electors);

        document.body.appendChild(tooltipDiv);
    };

    module.exports = { tooltipDiv, tooltipComponents, updateTooltip, createTooltip };
}
