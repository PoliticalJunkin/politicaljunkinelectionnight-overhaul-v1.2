/* Better Election Maps – better-maps/main.js
   UPDATED: Margin Buckets
   (<1, 1-5, 5-15, 15-30, 30-45, >45)
*/

{
    const path = require("path");
    const fs = require("fs");

    const d3 = require("./third-party/d3.v7.min.js");
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

    const {getCandidateColour, getPoliticianColour, stringifyColour} = require("./colours.js");
    const {tooltipDiv, tooltipComponents, updateTooltip, createTooltip} = require("./tooltip.js");

    const mod = {};

    const originalElectPageMap = Executive.functions.getOriginalFunction("electPageMap");
    const originalElectNightMap = Executive.functions.getOriginalFunction("electNightMap");

    const originalSummaryNationMap = Executive.functions.getOriginalFunction("summaryNationMap");

    let config = null;

    let onCountyMap = false;
    let onHouseDistrictMap = false;
    let lastMapElectionType = "none";

    let lastUpdateDataHook = null;
    let tooltipMotionFrame = null;
    let tooltipTargetX = 0;
    let tooltipTargetY = 0;

    const moveTooltipSmoothly = (event) => {
        const tooltipWidth = tooltipDiv.offsetWidth || 500;
        const tooltipHeight = tooltipDiv.offsetHeight || 220;
        const maxX = Math.max(12, window.innerWidth - tooltipWidth - 12);
        const maxY = Math.max(12, window.innerHeight - tooltipHeight - 12);
        tooltipTargetX = Math.max(12, Math.min(event.clientX + 15, maxX));
        tooltipTargetY = Math.max(12, Math.min(event.clientY + 15, maxY));
        if(tooltipMotionFrame !== null) return;

        tooltipMotionFrame = requestAnimationFrame(() => {
            tooltipDiv.style.left = tooltipTargetX + "px";
            tooltipDiv.style.top = tooltipTargetY + "px";
            tooltipMotionFrame = null;
        });
    };

    /* --- SISTEMA DE ALERTAS DE PROJEÇÃO --- */
    const shownProjections = new Set();
    let alertContainer = null;

    const createAlertContainer = () => {
        if (!document.getElementById("projection-alert-container")) {
            alertContainer = document.createElement("div");
            alertContainer.setAttribute("id", "projection-alert-container");
            document.body.appendChild(alertContainer);
        }
    };

    const showProjectionAlert = (winnerName, partyColor, stateName, office) => {
        if (!alertContainer) createAlertContainer();

        const alertDiv = document.createElement("div");
        alertDiv.setAttribute("class", "projection-alert");
        alertDiv.style.backgroundColor = stringifyColour(partyColor);

        const iconDiv = document.createElement("div");
        iconDiv.setAttribute("class", "alert-check-icon");
        iconDiv.innerText = "✓";
        alertDiv.appendChild(iconDiv);

        const textSpan = document.createElement("span");
        textSpan.innerText = `${winnerName} wins ${stateName} ${office}`;
        alertDiv.appendChild(textSpan);

        alertContainer.appendChild(alertDiv);

        setTimeout(() => {
            alertDiv.style.animation = "alertFadeOut 0.5s ease forwards";
            setTimeout(() => {
                if (alertDiv.parentElement) alertDiv.remove();
            }, 500);
        }, 5000);
    };

    const checkAndShowProjections = (electionType) => {
        if (!resultProxies[electionType]) return;

        const allDistricts = Object.keys(resultProxies[electionType]);

        allDistricts.forEach(districtId => {
            const district = resultProxies[electionType][districtId];
            
            const projected = district && (district.pW === true
                || district.projected === true
                || district.final === true
                || (Array.isArray(district.cands) && district.cands.some(candidateHasWinFlag)));
            if (projected) {
                const cacheKey = `${electionType}-${districtId}`;

                if (!shownProjections.has(cacheKey)) {
                    const raceInfo = getRaceInfo(district, true);
                    const winner = raceInfo.finalWinner;
                    
                    if (winner) {
                        const winnerColor = getCandidateColour(winner);
                        const stateName = Executive.data.states[districtId].name;
                        
                        let officeName = "";
                        if (electionType === "president") officeName = ""; 
                        if (electionType === "usSenate") officeName = "(Senate)";
                        if (electionType === "governor") officeName = "(Governor)";

                        showProjectionAlert(winner.name.split(" ").pop(), winnerColor, stateName, officeName);
                        shownProjections.add(cacheKey);
                    }
                }
            }
        });
    };

    /* --- LÓGICA DE CORES (MARGEM) --- */

    /* Helper para definir a intensidade da cor baseada na MARGEM */
    const getMarginScaleFactor = (margin) => {
        // Tilt / Lean / Likely / Safe / Solid margin categories.
        // margin is decimal: 0.05 = 5%.
        if (margin >= 0.25) return "solid";  // 25%+
        if (margin >= 0.10) return "safe";   // 10-25%
        if (margin >= 0.05) return "likely"; // 5-9%
        if (margin >= 0.01) return "lean";   // 1-4%
        return "tilt";                       // under 1%
    };

    const getMarginBucketColour = (baseColour, margin) => {
        const bucket = getMarginScaleFactor(margin);

        // Dark NBC-style colors, but clearly stepped by margin.
        const palette = {
            tilt:   { s: 48,  l: 84 },
            lean:   { s: 64,  l: 76 },
            likely: { s: 82,  l: 62 },
            safe:   { s: 96,  l: 49 },
            solid:  { s: 100, l: 35 }
        };

        const step = palette[bucket];

        return stringifyColour({
            h: baseColour.h,
            s: step.s,
            l: step.l
        });
    };

    const getLiveLeadHexColour = (party) => {
        const key = String(party || "I").charAt(0).toUpperCase();
        if(key === "D") return "#8ecaff";
        if(key === "R") return "#ff9a9a";
        return "#d9c2ff";
    };

    const getPrimaryReportingHexColour = (reportedPercent) => {
        const pct = Math.max(0, Math.min(100, safeNum(reportedPercent))) / 100;
        const start = { r: 255, g: 247, b: 176 };
        const end = { r: 176, g: 111, b: 0 };
        const ease = pct * pct * (3 - (2 * pct));
        const toHex = value => Math.round(value).toString(16).padStart(2, "0");
        const r = start.r + ((end.r - start.r) * ease);
        const g = start.g + ((end.g - start.g) * ease);
        const b = start.b + ((end.b - start.b) * ease);
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    };


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

    const getMunicipalityTurnoutMultiplier = (electionType) => {
        if(electionType === "president") return 1;
        if(electionType === "governor" || electionType === "usSenate") return 0.64;
        return 0.72;
    };

    const getCandidateVotes = (cand, live) => safeNum(
        live ? (cand.currentVotes ?? cand.currVotes ?? cand.liveVotes ?? cand.votes ?? cand.totVotes) : (cand.votes ?? cand.totVotes ?? cand.totalVotes),
        safeNum(cand.votes ?? cand.totVotes ?? cand.totalVotes)
    );

    const getBlockCandidates = (block, party) => {
        if(!block || !Array.isArray(block.cands)) return [];
        return block.cands.map(cand => Object.assign({ party }, cand));
    };

    const getDistrictCandidates = (district) => {
        if(!district) return [];
        if(Array.isArray(district.cands)) return district.cands;
        if(Array.isArray(district.candidates)) return district.candidates;
        if(Array.isArray(district.Candidates)) return district.Candidates;
        return []
            .concat(getBlockCandidates(district.dem, "D"))
            .concat(getBlockCandidates(district.rep, "R"))
            .concat(getBlockCandidates(district.ind, "I"))
            .concat(getBlockCandidates(district.nonpartisan, "I"));
    };

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

    const getHouseLiveCandidateVotes = (cand, district) => {
        if(!cand) return 0;
        const stateElectData = getHouseStateElectData(district);
        if(!hasHouseStateVoteDump(district, true)) return 0;
        if(stateElectData && cand.updates && cand.updates[stateElectData.indx] !== undefined){
            return Math.round(safeNum(cand.votes) * safeNum(cand.updates[stateElectData.indx], 0));
        }
        return 0;
    };

    const getDistrictCandidateVotes = (cand, district, live) => {
        if(live && district && district._betterMapsHouseDistrict === true) return getHouseLiveCandidateVotes(cand, district);
        return getCandidateVotes(cand, live);
    };

    const isPrimaryDistrict = (district) => {
        if(!district) return false;
        if(district.dem || district.rep || district.ind || district.nonpartisan) return true;
        const text = String(`${district.category || ""} ${district.type || ""} ${district.electionType || ""} ${district.name || ""}`).toLowerCase();
        return text.indexOf("primary") !== -1;
    };

    const getPrimaryReportingPercent = (district, live) => {
        if(!isPrimaryDistrict(district)) return null;
        if(!live || district.pW === true || district.projected === true || district.final === true) return 100;
        const cands = getDistrictCandidates(district);
        const totalFinal = cands.reduce((sum, cand) => sum + safeNum(cand.votes), 0);
        const totalCurrent = cands.reduce((sum, cand) => sum + getDistrictCandidateVotes(cand, district, true), 0);
        if(totalFinal <= 0) return 0;
        return Math.max(0, Math.min(100, (totalCurrent / totalFinal) * 100));
    };

    const getPrimaryDistrictsReportingPercent = (districts, live) => {
        const primaryDistricts = (districts || []).filter(isPrimaryDistrict);
        if(primaryDistricts.length === 0) return null;
        const total = primaryDistricts.reduce((sum, district) => sum + safeNum(getPrimaryReportingPercent(district, live)), 0);
        return total / primaryDistricts.length;
    };

    const getPartyKey = (cand) => {
        if(!cand) return "";
        if(cand.party === "I") return cand.caucus ? "I" + cand.caucus : "I";
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

    const getCandidatePartyKey = (cand) => {
        return normalizePartyKey(getPartyKey(cand)) || getObjectPartyKey(cand);
    };

    const candidateHasWinFlag = (cand) => {
        if(!cand) return false;
        return cand.pW === true
            || cand.winner === true
            || cand.won === true
            || cand.projected === true
            || cand.final === true;
    };

    const getActualRaceParties = (electionType) => {
        const stateDistrict = resultProxies[electionType] ? resultProxies[electionType][activeMap] : null;
        if(!stateDistrict || !stateDistrict.cands) return [];
        const parties = [];
        stateDistrict.cands.forEach(cand => {
            const party = cand.party === "I" ? "I" : getPartyKey(cand).charAt(0);
            if(party && parties.indexOf(party) === -1) parties.push(party);
        });
        return parties;
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

    const sameDistrictName = (value, stateId, stateObj) => {
        if(value === undefined || value === null) return false;
        const normalized = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
        const rawStateCode = String(stateId || "").toLowerCase().split("__")[0];
        const stateName = stateObj && stateObj.name ? String(stateObj.name).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        const fallbackName = stateNameByCode[rawStateCode] ? stateNameByCode[rawStateCode].toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        const stateCode = rawStateCode.replace(/[^a-z0-9]/g, "");
        return normalized === stateName || normalized === fallbackName || normalized === stateCode;
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

    const fitOutlineGroupToViewport = (svgMap, outlineGroup, origWidth, origHeight) => {
        if(!onCountyMap) return false;
        if(!outlineGroup || typeof outlineGroup.getBBox !== "function") return false;

        let bbox = null;
        try {
            bbox = outlineGroup.getBBox();
        } catch(err) {
            return false;
        }

        if(!bbox || bbox.width <= 0 || bbox.height <= 0) return false;

        const padX = Math.max(bbox.width * 0.025, 2);
        const padY = Math.max(bbox.height * 0.025, 2);
        outlineGroup.removeAttribute("transform");
        svgMap.setAttribute("viewBox", `${bbox.x - padX} ${bbox.y - padY} ${bbox.width + (padX * 2)} ${bbox.height + (padY * 2)}`);
        svgMap.setAttribute("preserveAspectRatio", "xMidYMid meet");
        return true;
    };

    const getCountySwingSource = (electionType, live) => {
        try {
            const stateDistrict = resultProxies[electionType][activeMap];
            if(!stateDistrict || !stateDistrict.counties || stateDistrict.counties.length === 0) return null;

            // Use whole-state county aggregate as the source-of-truth swing.
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
            const swing = demShare - getStateMunicipalityBaseline(activeMap);

            return {
                demShare,
                swing,
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
        if(!meta) return null;
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


    const getRaceInfo = (district, live) => {
        const districtCands = getDistrictCandidates(district);
        if(districtCands.length === 0){
            return {
                currentLeader: null,
                currentLead: 0,
                leaderVotes: 0,
                finalWinner: null
            };
        }
        const sortedCands = districtCands.slice().sort((cand1, cand2) => {
            if(live) return getDistrictCandidateVotes(cand2, district, true) - getDistrictCandidateVotes(cand1, district, true);
            return cand2.votes - cand1.votes;
        });

        const topVotes = getDistrictCandidateVotes(sortedCands[0], district, live);
        const secondVotes = (sortedCands[1] !== undefined) ? getDistrictCandidateVotes(sortedCands[1], district, live) : 0;

        const info = {
            currentLeader: sortedCands[0],
            currentLead: topVotes - secondVotes,
            leaderVotes: topVotes,
            finalWinner: null
        };

        const projected = district.pW === true
            || district.projected === true
            || district.final === true
            || districtCands.some(candidateHasWinFlag);
        if(projected){
            const flaggedWinner = sortedCands.filter(candidateHasWinFlag)[0];
            if(flaggedWinner){
                info.finalWinner = flaggedWinner;
                return info;
            }
            const resortedCands = sortedCands.sort((cand1, cand2) => {
                return getCandidateVotes(cand2, false) - getCandidateVotes(cand1, false);
            });
            info.finalWinner = resortedCands[0];
        } else {
            info.finalWinner = info.currentLeader;
        }

        return info;
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

    const getArchiveForElectionType = (electionType) => {
        const names = electionType === "president"
            ? ["presidentialArchive", "presidentArchive", "presArchive", "presidentElectionArchive", "presidentialElectionArchive", "archivedPresidentialElections", "presidentialElectionHistory", "presidentElectionHistory", "presElectionHistory", "presidentialHistory", "presidentHistory", "electionArchive", "electionsArchive", "archivedElections", "electionHistory", "electionsHistory", "pastElections", "previousElections", "history"]
            : (electionType === "usSenate"
                ? ["usSenateArchive", "senateArchive", "usSenateElectionArchive", "senateElectionHistory", "electionArchive", "electionsArchive", "archivedElections", "electionHistory", "electionsHistory", "pastElections", "previousElections", "history"]
                : ["allGovArchive", "governorArchive", "govArchive", "governorElectionArchive", "governorElectionHistory", "gubernatorialElectionHistory", "electionArchive", "electionsArchive", "archivedElections", "electionHistory", "electionsHistory", "pastElections", "previousElections", "history"]);
        for(let i = 0; i < names.length; i++){
            const value = getGlobalArchiveCandidate(names[i]);
            const entries = extractArchiveEntries(value, names[i]);
            const typedEntries = entries.filter(entry => archiveEntryMatchesType(entry, names[i], electionType));
            if(typedEntries.length > 0) return typedEntries;
            if(entries.length > 0 && archiveNameMatchesType(names[i], electionType)) return entries;
        }
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
            const child = value[keys[i]];
            const childEntries = extractArchiveEntries(child, keys[i] || sourceName, depth + 1);
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

    const getLatestArchiveElection = (electionType) => {
        const archiveArray = getArchiveForElectionType(electionType);
        if(!archiveArray) return null;
        const currentYearValue = getCurrentElectionYear();
        const withLists = archiveArray
            .filter(item => getArchiveElectionList(item).length > 0)
            .filter(item => electionType !== "president" || currentYearValue <= 0 || safeNum(item.year, safeNum(item.date)) < currentYearValue)
            .sort((a, b) => safeNum(b.year, safeNum(b.date)) - safeNum(a.year, safeNum(a.date)));
        return withLists.filter(isGeneralArchiveElection)[0] || withLists[0] || null;
    };

    const getPreviousStateElectionDistrict = (electionType, stateId) => {
        const lastElection = getLatestArchiveElection(electionType);
        const elections = getArchiveElectionList(lastElection);
        if(!lastElection || elections.length === 0) return false;
        const stateObj = Executive.data.states[String(stateId || "").toLowerCase()];
        const fallbackName = stateNameByCode[String(stateId || "").toLowerCase().split("__")[0]] || "";
        return elections.filter(dist => (stateObj && dist.district === stateObj.name)
            || (fallbackName && sameDistrictName(dist.district, stateId, stateObj))
            || sameDistrictName(dist.district, stateId, stateObj)
            || sameDistrictName(dist.state, stateId, stateObj)
            || sameDistrictName(dist.stateName, stateId, stateObj)
            || sameDistrictName(dist.name, stateId, stateObj)
            || sameDistrictName(dist.id, stateId, stateObj)
            || sameDistrictName(dist.stateId, stateId, stateObj))[0];
    };

    const scanPreviousParty = (obj, depth = 0, seen = [], allowRaceObject = false) => {
        if(!obj || typeof obj !== "object" || depth > 5 || seen.indexOf(obj) !== -1) return "";
        seen.push(obj);

        if(allowRaceObject && getDistrictCandidates(obj).length > 0){
            const info = getRaceInfo(obj, false);
            const party = getCandidatePartyKey(info.finalWinner || info.currentLeader);
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

    const getArchivePreviousWinnerParty = (electionType, stateId) => {
        if(electionType === "president"){
            const previousState = getPreviousStateElectionDistrict(electionType, stateId);
            if(previousState){
                const previousStats = getRaceInfo(previousState, false);
                const previousWinner = previousStats.finalWinner || previousStats.currentLeader;
                const previousParty = getCandidatePartyKey(previousWinner) || scanPreviousParty(previousState, 0, [], true);
                if(previousParty) return previousParty;
            }
        }
        const previous = getPreviousStateElectionDistrict(electionType, stateId);
        if(!previous) return "";
        const previousInfo = getRaceInfo(previous, false);
        return getCandidatePartyKey(previousInfo.finalWinner || previousInfo.currentLeader)
            || scanPreviousParty(previous, 0, [], true);
    };

    const getPreviousWinnerParty = (electionType, stateId, currentDistrict) => {
        if(electionType !== "president" && currentDistrict && Array.isArray(currentDistrict.cands)){
            const incumbent = currentDistrict.cands.filter(cand => cand.incumbent === true)[0];
            const incumbentParty = getCandidatePartyKey(incumbent);
            if(incumbentParty) return incumbentParty;
        }

        const archiveParty = getArchivePreviousWinnerParty(electionType, stateId);
        if(archiveParty) return archiveParty;

        const stateObj = Executive.data.states[String(stateId || "").toLowerCase()];
        return scanPreviousParty(currentDistrict) || scanPreviousParty(stateObj);
    };

    const isFlippedStateRace = (electionType, stateId, currentDistrict, live) => {
        const districtCands = getDistrictCandidates(currentDistrict);
        if(!currentDistrict || districtCands.length === 0) return false;
        const projected = currentDistrict.pW === true
            || currentDistrict.projected === true
            || currentDistrict.final === true
            || !live
            || districtCands.some(candidateHasWinFlag);
        const currentInfo = getRaceInfo(currentDistrict, live);
        if(!projected && electionType !== "president") return false;
        if(!projected && electionType === "president" && (!currentInfo.currentLeader || currentInfo.leaderVotes <= 0)) return false;
        const currentWinner = currentInfo.finalWinner || currentInfo.currentLeader;
        if(!currentWinner) return false;
        const currentParty = getCandidatePartyKey(currentWinner);
        const previousParty = getPreviousWinnerParty(electionType, stateId, currentDistrict);
        return !!(currentParty && previousParty && currentParty !== previousParty);
    };

    const getDistrictTotalVotes = (district, live) => {
        const districtCands = getDistrictCandidates(district);
        if(!district || districtCands.length === 0) return 0;
        if(live && district._betterMapsHouseDistrict === true){
            return districtCands.reduce((sum, cand) => sum + getHouseLiveCandidateVotes(cand, district), 0);
        }
        const candidateTotal = districtCands.reduce((sum, cand) => sum + safeNum(live ? cand.currentVotes : cand.votes, safeNum(cand.votes)), 0);
        return safeNum(live ? district.totalCurrVotes : district.totalVotes, safeNum(district.totalVotes, candidateTotal));
    };

    const getHouseDistrictByHexId = (hexId) => {
        const parts = String(hexId || "").toLowerCase().replace(/-state-path-live$/, "").replace(/-state-path$/, "").split("__");
        if(parts.length !== 2 || !resultProxies.usHouse[parts[0]]) return null;
        const district = resultProxies.usHouse[parts[0]].districts[safeNum(parts[1], -1)];
        if(!district) return null;
        district._betterMapsHouseDistrict = true;
        district._betterMapsStateId = parts[0];
        district._betterMapsDistrictIndex = safeNum(parts[1], 0);
        return district;
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

    const getObjectPviRaw = (obj, depth = 0, seen = []) => {
        if(!obj || depth > 4 || seen.indexOf(obj) !== -1) return null;
        seen.push(obj);

        const directKeys = ["pvi", "PVI", "districtPvi", "districtPVI", "cookPvi", "cookPVI", "partisanLean", "partisan_lean", "lean", "partisanIndex", "partisanVotingIndex", "districtLean"];
        for(let i = 0; i < directKeys.length; i++){
            if(Object.prototype.hasOwnProperty.call(obj, directKeys[i])){
                const parsed = parsePviValue(obj[directKeys[i]]);
                if(parsed !== null) return parsed;
            }
        }

        const dem = [obj.demPop, obj.dem, obj.demShare, obj.democraticShare, obj.democratShare, obj.democraticPop, obj.democratPop, obj.demPct, obj.demPercent, obj.D]
            .filter(value => value !== undefined && value !== null && value !== "")
            .map(Number).filter(Number.isFinite)[0];
        const rep = [obj.repPop, obj.rep, obj.repShare, obj.republicanShare, obj.republicanPop, obj.repPct, obj.repPercent, obj.R]
            .filter(value => value !== undefined && value !== null && value !== "")
            .map(Number).filter(Number.isFinite)[0];
        if(dem !== undefined && rep !== undefined){
            const demShare = Math.abs(dem) <= 1 ? dem * 100 : dem;
            const repShare = Math.abs(rep) <= 1 ? rep * 100 : rep;
            return demShare - repShare;
        }

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
                const nested = getObjectPviRaw(value, depth + 1, seen);
                if(nested !== null) return nested;
            }
        }
        return null;
    };

    const firstNumeric = (...values) => {
        for(let i = 0; i < values.length; i++){
            if(values[i] === undefined || values[i] === null || values[i] === "") continue;
            const n = Number(values[i]);
            if(Number.isFinite(n)) return n;
        }
        return null;
    };

    const normalizeShareValue = (value) => {
        const n = Number(value);
        if(!Number.isFinite(n)) return null;
        return Math.abs(n) <= 1 ? n * 100 : n;
    };

    const getObjectRegistrationGap = (obj, depth = 0, seen = []) => {
        if(!obj || depth > 4 || seen.indexOf(obj) !== -1) return null;
        seen.push(obj);

        const directGap = firstNumeric(
            obj.partyRegistrationGap,
            obj.registrationGap,
            obj.voterRegistrationGap,
            obj.regGap,
            obj.partyRegGap
        );
        if(directGap !== null) return Math.abs(normalizeShareValue(directGap));

        const demCount = firstNumeric(obj.registeredDemocrat, obj.registeredDemocrats, obj.demRegistered, obj.democratRegistered, obj.demVoters, obj.democraticVoters);
        const repCount = firstNumeric(obj.registeredRepublican, obj.registeredRepublicans, obj.repRegistered, obj.republicanRegistered, obj.repVoters, obj.republicanVoters);
        const totalCount = firstNumeric(obj.totalRegisteredVoters, obj.registeredVoters, obj.totalVoters, obj.votingPopulation);
        if(demCount !== null && repCount !== null && totalCount !== null && totalCount > 0){
            return Math.abs(((demCount - repCount) / totalCount) * 100);
        }

        const demShare = normalizeShareValue(firstNumeric(obj.demPop, obj.dem, obj.demShare, obj.democraticShare, obj.democratShare, obj.demPct, obj.demPercent, obj.D));
        const repShare = normalizeShareValue(firstNumeric(obj.repPop, obj.rep, obj.repShare, obj.republicanShare, obj.repPct, obj.repPercent, obj.R));
        if(demShare !== null && repShare !== null) return Math.abs(demShare - repShare);

        const keys = Object.keys(obj);
        for(let i = 0; i < keys.length; i++){
            const value = obj[keys[i]];
            if(value && typeof value === "object"){
                const nested = getObjectRegistrationGap(value, depth + 1, seen);
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

    const getHouseDistrictLookupObjects = (district, stateId) => {
        const stateKey = String(stateId || district.state || district.stateId || district._betterMapsStateId || "").toLowerCase().split("__")[0];
        const stateObj = Executive.data.states[stateKey];
        const districtNum = normalizeDistrictNumber(district);
        const objects = [district];
        const possibleArrays = [];
        if(stateObj){
            ["districts", "congressionalDistricts", "houseDistricts", "usHouseDistricts", "congDistricts", "cds"].forEach(key => {
                if(Array.isArray(stateObj[key])) possibleArrays.push(stateObj[key]);
            });
        }
        if(Executive.data.politicians && Executive.data.politicians.usHouse && Array.isArray(Executive.data.politicians.usHouse[stateKey])){
            possibleArrays.push(Executive.data.politicians.usHouse[stateKey]);
        }
        possibleArrays.forEach(list => {
            list.forEach(item => {
                if(districtNum !== null && getNestedDistrictNumber(item) === districtNum) objects.push(item);
            });
        });
        collectDistrictLookupObjects(stateObj, districtNum, objects);
        if(Executive.data.politicians && Executive.data.politicians.usHouse){
            collectDistrictLookupObjects(Executive.data.politicians.usHouse[stateKey], districtNum, objects);
        }
        return objects.filter(Boolean);
    };

    const getDistrictPviInfo = (district, stateId) => {
        const stateKey = String(stateId || district.state || district.stateId || district._betterMapsStateId || "").toLowerCase().split("__")[0];
        const districtNum = normalizeDistrictNumber(district);
        const objects = getHouseDistrictLookupObjects(district, stateId);
        for(let i = 0; i < objects.length; i++){
            const raw = getObjectPviRaw(objects[i]);
            if(raw !== null){
                const normalized = Math.abs(raw) <= 1 ? raw * 100 : raw;
                if(Math.abs(normalized) < 0.5) return { value: null, source: "" };
                return {
                    value: Math.abs(normalized),
                    raw: normalized,
                    party: normalized >= 0.5 ? "D" : "R",
                    source: "district"
                };
            }
        }
        const planPvi = houseDistrictPviData.getHouseDistrictPvi(stateKey, districtNum);
        if(planPvi && Number.isFinite(planPvi.rawPvi)){
            const normalized = planPvi.rawPvi;
            if(Math.abs(normalized) < 0.5) return { value: null, source: "" };
            return {
                value: Math.abs(normalized),
                raw: normalized,
                party: normalized >= 0.5 ? "D" : "R",
                source: "district"
            };
        }
        return { value: null, source: "" };
    };

    const getDistrictRegistrationGapInfo = (district, stateId) => {
        const objects = getHouseDistrictLookupObjects(district, stateId);
        for(let i = 0; i < objects.length; i++){
            const gap = getObjectRegistrationGap(objects[i]);
            if(gap !== null) return { value: gap, source: "district" };
        }
        return { value: null, source: "" };
    };

    const getHouseRaceMarginPercent = (district, live) => {
        const cands = getDistrictCandidates(district);
        if(!district || cands.length < 2) return null;
        const sorted = cands.slice().sort((a, b) => getDistrictCandidateVotes(b, district, live) - getDistrictCandidateVotes(a, district, live));
        let topVotes = getDistrictCandidateVotes(sorted[0], district, live);
        let secondVotes = getDistrictCandidateVotes(sorted[1], district, live);
        let totalVotes = getDistrictTotalVotes(district, live);
        if(totalVotes <= 0){
            const finalSorted = cands.slice().sort((a, b) => safeNum(b.votes ?? b.totVotes ?? b.totalVotes) - safeNum(a.votes ?? a.totVotes ?? a.totalVotes));
            topVotes = safeNum(finalSorted[0] && (finalSorted[0].votes ?? finalSorted[0].totVotes ?? finalSorted[0].totalVotes));
            secondVotes = safeNum(finalSorted[1] && (finalSorted[1].votes ?? finalSorted[1].totVotes ?? finalSorted[1].totalVotes));
            totalVotes = cands.reduce((sum, cand) => sum + safeNum(cand.votes ?? cand.totVotes ?? cand.totalVotes), 0);
        }
        if(totalVotes <= 0) return null;
        return Math.abs(topVotes - secondVotes) / totalVotes * 100;
    };

    const isHouseCloseMarginRace = (district) => {
        const margin = getHouseRaceMarginPercent(district, true);
        return margin !== null && margin <= 7;
    };

    const isHouseTippingPointRace = (district, stateId) => {
        const text = `${district.rating || ""} ${district.raceRating || ""} ${district.status || ""} ${district.notes || ""}`.toLowerCase();
        if(text.indexOf("tipping") !== -1 || text.indexOf("toss") !== -1 || text.indexOf("key") !== -1) return true;
        const margin = getHouseRaceMarginPercent(district, true);
        return margin !== null && margin <= 2.5;
    };

    const getHouseIncumbentParty = (district) => {
        if(!district || !district.cands) return null;
        const incumbent = district.cands.filter(cand => cand.incumbent === true)[0];
        if(!incumbent) return null;
        return getPartyKey(incumbent).charAt(0);
    };

    const isDistrictProjected = (district, live) => {
        if(!district) return false;
        if(!live) return true;
        if(district.pW === true || district.projected === true || district.final === true) return true;
        return getDistrictCandidates(district).some(candidateHasWinFlag);
    };

    const getHouseStatePartyVotes = (houseState, live) => {
        const votes = { D: 0, R: 0, I: 0 };
        const districts = houseState && houseState.districts ? houseState.districts : [];
        districts.forEach(district => {
            if(!district || !district.cands) return;
            district._betterMapsHouseDistrict = true;
            district.cands.forEach(cand => {
                const party = getPartyKey(cand).charAt(0);
                const key = party === "D" || party === "R" ? party : "I";
                votes[key] += getDistrictCandidateVotes(cand, district, live);
            });
        });
        return votes;
    };

    const getHouseHexFill = (district, live, projectedView) => {
        if(isPrimaryDistrict(district)){
            return getPrimaryReportingHexColour(getPrimaryReportingPercent(district, live));
        }
        const info = getRaceInfo(district, live);
        const liveVotes = getDistrictTotalVotes(district, live);
        if(live && (!info.currentLeader || info.leaderVotes <= 0 || liveVotes <= 0)) return "#697386";
        if(!info.currentLeader || info.leaderVotes <= 0) return "#d7d1a2";
        const projected = isDistrictProjected(district, live);
        const displayLeader = projected ? (info.finalWinner || info.currentLeader) : info.currentLeader;
        const party = getPartyKey(displayLeader).charAt(0) || "I";
        const baseColour = getCandidateColour(displayLeader);
        const totalVotes = getDistrictTotalVotes(district, live);
        const margin = totalVotes > 0 ? info.currentLead / totalVotes : 0;
        const flipped = projected && getHouseIncumbentParty(district) && getHouseIncumbentParty(district) !== party;
        if(projectedView){
            if(!projected) return live && totalVotes > 0 ? stringifyColour({ h: 51, s: 20, l: 63 }) : "#697386";
            if(flipped) return `url(#${party}:gain)`;
            return stringifyColour({ h: baseColour.h, s: Math.max(88, safeNum(baseColour.s, 100)), l: Math.min(36, safeNum(baseColour.l, 36)) });
        }
        return getMarginBucketColour(baseColour, margin);
    };

    const updateHouseHexMap = (svgMap, live, projectedView) => {
        const paths = svgMap.getElementsByClassName("better-maps-house-hex");
        for(let i = 0; i < paths.length; i++){
            const pathElem = paths[i];
            const district = getHouseDistrictByHexId(pathElem.getAttribute("data-hex-id"));
            if(!district) continue;
            const districtCands = getDistrictCandidates(district);
            const totalVotes = getDistrictTotalVotes(district, live);
            const finalVotes = safeNum(district.totalVotes, districtCands.reduce((sum, cand) => sum + safeNum(cand.votes), 0));
            const reporting = finalVotes > 0 ? Math.max(0, Math.min(1, totalVotes / finalVotes)) : (district.pW === true ? 1 : 0);
            const info = getRaceInfo(district, live);
            const margin = totalVotes > 0 ? Math.max(0, Math.min(1, info.currentLead / totalVotes)) : 0;
            pathElem.style.fill = getHouseHexFill(district, live, projectedView);
            const projected = isDistrictProjected(district, live);
            pathElem.style.opacity = (live && totalVotes <= 0) ? "0.74" : (projected ? "1" : String(Math.max(0.44, Math.min(0.98, 0.50 + (margin * 2.2) + (reporting * 0.22)))));
        }
    };

    const stateHexAnchors = {
        wa:[0,0], or:[0,1], ca:[0,2], id:[1,1], nv:[1,2], az:[1,3],
        mt:[2,0], wy:[2,1], ut:[2,2], nm:[2,3], nd:[3,0], sd:[3,1],
        co:[3,2], ok:[3,3], tx:[3,4], mn:[4,0], ia:[4,1], ne:[4,2],
        ks:[4,3], mo:[5,2], ar:[5,3], la:[5,4], wi:[5,0], il:[5,1],
        mi:[6,0], "in":[6,1], ky:[6,2], tn:[6,3], ms:[6,4], al:[7,4],
        ga:[8,4], fl:[9,5], oh:[7,1], wv:[7,2], va:[8,2], nc:[9,2],
        sc:[9,3], pa:[8,1], md:[9,1], de:[10,1], nj:[9,0], ny:[8,0],
        ct:[10,0], ri:[11,0], ma:[9,-1], vt:[8,-1], nh:[9,-2], me:[10,-2],
        ak:[-2,4], hi:[1,5]
    };

    const makeHexPath = (cx, cy, r) => {
        const points = [];
        for(let i = 0; i < 6; i++){
            const angle = (Math.PI / 180) * (60 * i - 90);
            points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
        }
        return `M${points.join(" L")} Z`;
    };

    const buildHouseHexSvg = (origWidth, origHeight, selectedStateId) => {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        const selectedState = selectedStateId ? String(selectedStateId).toLowerCase() : null;
        const stateSize = selectedState ? 50 : 54;
        const stateDx = Math.sqrt(3) * stateSize;
        const stateDy = 1.5 * stateSize;
        const stateIds = selectedState ? [selectedState] : Object.keys(stateHexAnchors);
        const anchorValues = stateIds.map(stateId => {
            const coord = stateHexAnchors[stateId];
            return { stateId, ax: coord[0] + (coord[1] * 0.5), row: coord[1] };
        });
        const minAx = Math.min(...anchorValues.map(item => item.ax));
        const maxAx = Math.max(...anchorValues.map(item => item.ax));
        const minRow = Math.min(...anchorValues.map(item => item.row));
        const maxRow = Math.max(...anchorValues.map(item => item.row));
        const viewWidth = selectedState ? 900 : Math.ceil(((maxAx - minAx) * stateDx) + 210);
        const viewHeight = selectedState ? 620 : Math.ceil(((maxRow - minRow) * stateDy) + 190);
        svg.setAttribute("width", String(viewWidth));
        svg.setAttribute("height", String(viewHeight));
        svg.setAttribute("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
        const group = document.createElementNS(ns, "g");
        svg.appendChild(group);
        const getHouseEntries = (stateId) => {
            const houseState = resultProxies.usHouse[stateId];
            if(!houseState || !houseState.districts) return [];
            return houseState.districts.map((district, originalIndex) => ({ district, originalIndex })).sort((a, b) => {
                const aNum = safeNum(String(a.district.district || a.district.name || "").match(/\d+/), 999);
                const bNum = safeNum(String(b.district.district || b.district.name || "").match(/\d+/), 999);
                return aNum - bNum;
            });
        };
        const getStateHexMetrics = (districtCount) => {
            if(selectedState){
                const cols = districtCount <= 8
                    ? Math.max(1, districtCount)
                    : (districtCount <= 12 ? Math.ceil(districtCount / 2) : (districtCount >= 40 ? 8 : (districtCount >= 30 ? 7 : Math.max(1, Math.ceil(Math.sqrt(districtCount * 1.55))))));
                const rows = Math.max(1, Math.ceil(districtCount / cols));
                const maxRByWidth = 860 / (((cols - 1) * Math.sqrt(3)) + 2.5);
                const maxRByHeight = 520 / (((rows - 1) * 1.5) + 2.5);
                const r = Math.max(54, Math.min(104, maxRByWidth, maxRByHeight));
                const width = ((cols - 1) * Math.sqrt(3) * r) + (r * 2.4);
                const height = ((rows - 1) * r * 1.5) + (r * 2.4);
                return { cols, rows, r, width, height };
            }
            const cols = Math.max(1, Math.ceil(Math.sqrt(districtCount * 1.05)));
            const rows = Math.max(1, Math.ceil(districtCount / cols));
            const r = districtCount >= 35 ? 4.8 : (districtCount >= 15 ? 5.6 : 7.2);
            const width = Math.max(22, ((cols - 1) * Math.sqrt(3) * r) + (r * 2.4));
            const height = ((rows - 1) * r * 1.5) + (r * 2.4);
            return { cols, rows, r, width, height };
        };
        const getStateCenter = (stateId) => {
            if(selectedState) return { x: viewWidth / 2, y: viewHeight / 2 };
            const coord = stateHexAnchors[stateId];
            const ax = coord[0] + (coord[1] * 0.5);
            return {
                x: 88 + ((ax - minAx) * stateDx),
                y: 88 + ((coord[1] - minRow) * stateDy)
            };
        };
        const drawState = (stateId, districts, centerX, centerY) => {
            const metrics = getStateHexMetrics(districts.length);
            const cols = metrics.cols;
            const r = metrics.r;
            const dx = Math.sqrt(3) * r;
            const dy = r * 1.5;
            if(!selectedState){
                const stateShell = document.createElementNS(ns, "path");
                stateShell.setAttribute("class", "better-maps-house-state-shell");
                stateShell.setAttribute("d", makeHexPath(centerX, centerY, stateSize * 0.68));
                group.appendChild(stateShell);
            }
            const stateLabel = document.createElementNS(ns, "text");
            stateLabel.setAttribute("class", "better-maps-house-state-label");
            stateLabel.setAttribute("x", centerX.toFixed(2));
            stateLabel.setAttribute("y", selectedState ? 34 : (centerY - (stateSize * 0.50)).toFixed(2));
            stateLabel.textContent = stateId.toUpperCase();
            group.appendChild(stateLabel);
            const clusterWidth = ((cols - 1) * dx) + (r * 2);
            const clusterHeight = ((metrics.rows - 1) * dy) + (r * 2);
            const baseX = centerX - (clusterWidth / 2) + r;
            const baseY = selectedState ? Math.max(80, ((viewHeight - clusterHeight) / 2) + r) : (centerY - (clusterHeight / 2) + r + 4);
            districts.forEach((entry, index) => {
                const district = entry.district;
                district._betterMapsHouseDistrict = true;
                district._betterMapsStateId = stateId;
                district._betterMapsDistrictIndex = entry.originalIndex;
                const col = index % cols;
                const row = Math.floor(index / cols);
                const x = baseX + (col * dx) + ((row % 2) * dx / 2);
                const y = baseY + (row * dy);
                const pathElem = document.createElementNS(ns, "path");
                const hexId = `${stateId}__${entry.originalIndex}`;
                pathElem.setAttribute("id", hexId);
                pathElem.setAttribute("data-hex-id", hexId);
                pathElem.setAttribute("data-state", stateId);
                pathElem.setAttribute("d", makeHexPath(x, y, r));
                group.appendChild(pathElem);

                if(isHouseCloseMarginRace(district)){
                    const marker = document.createElementNS(ns, "circle");
                    const isKeyMarker = isHouseTippingPointRace(district, stateId);
                    const markerX = x + (r * 0.50);
                    const markerY = y - (r * 0.58);
                    marker.setAttribute("class", isKeyMarker ? "better-maps-house-key-marker" : "better-maps-house-bg-marker");
                    marker.setAttribute("data-marker-for", hexId);
                    marker.setAttribute("cx", markerX.toFixed(2));
                    marker.setAttribute("cy", markerY.toFixed(2));
                    marker.setAttribute("r", Math.max(2.2, r * (isKeyMarker ? 0.20 : 0.16)).toFixed(2));
                    group.appendChild(marker);
                }

                if(selectedState){
                    const districtText = document.createElementNS(ns, "text");
                    const districtMatch = String(district.district || district.name || "").match(/\d+/);
                    districtText.setAttribute("class", "better-maps-house-district-label");
                    districtText.setAttribute("x", x.toFixed(2));
                    districtText.setAttribute("y", (y + (r * 0.16)).toFixed(2));
                    districtText.textContent = districtMatch ? districtMatch[0] : String(index + 1);
                    group.appendChild(districtText);
                }
            });
        };
        stateIds.forEach(stateId => {
            if(!stateHexAnchors[stateId]) return;
            const districts = getHouseEntries(stateId);
            if(districts.length === 0) return;
            const center = getStateCenter(stateId);
            drawState(stateId, districts, center.x, center.y);
        });
        svg.setAttribute("width", origWidth);
        svg.setAttribute("height", origHeight);
        return svg;
    };

    const updateMap = (svgMap, resultColours, electionType, live, projected) => {
        svgMap.setAttribute("data-colours", JSON.stringify(resultColours));

        const resultKeys = Object.keys(resultColours);
        const raceInfoCache = {};
        const proxyResults = resultProxies[electionType] || {};

        /* Pre-calculate race info */
        if(!projected && electionType !== "usHouse" && electionType !== "usHousePol") {
            resultKeys.forEach(rawStateId => {
                const stateId = String(rawStateId).toLowerCase();
                const currentDistrict = proxyResults[stateId] || proxyResults[rawStateId];

                if(currentDistrict !== undefined && currentDistrict.cands !== undefined) {
                    raceInfoCache[stateId] = getRaceInfo(currentDistrict, live);
                    
                    const totalVotes = live ? currentDistrict.totalCurrVotes : currentDistrict.totalVotes;
                    // Cálculo da Margem
                    const margin = totalVotes > 0 
                        ? raceInfoCache[stateId].currentLead / totalVotes 
                        : 0;

                    raceInfoCache[stateId].currentMargin = margin;
                }
            });
        }

        resultKeys.forEach(rawStateId => {
            const stateId = String(rawStateId).toLowerCase();
            const resultColour = resultColours[rawStateId];
            const currentDistrict = proxyResults[stateId] || proxyResults[rawStateId];

            if(currentDistrict !== undefined && (electionType === "usHouse" || electionType === "usHousePol" 
                || electionType === "governorPol" || electionType === "usSenatePol" 
                || currentDistrict.cands !== undefined || isPrimaryDistrict(currentDistrict))) {
                
                let raceInfo = null;
                let newColour = null;

                if((electionType === "usHouse" || electionType === "usHousePol") && currentDistrict.districts && currentDistrict.districts.some(isPrimaryDistrict)) {
                    newColour = getPrimaryReportingHexColour(getPrimaryDistrictsReportingPercent(currentDistrict.districts, live));
                } else if(electionType === "usHouse" || electionType === "usHousePol") {
                    const houseCounts = {
                        D: safeNum(currentDistrict.projectedDem),
                        R: safeNum(currentDistrict.projectedRep),
                        I: safeNum(currentDistrict.projectedInd)
                    };
                    const displayCounts = (electionType === "usHouse" && !projected && currentDistrict.districts)
                        ? getHouseStatePartyVotes(currentDistrict, live)
                        : houseCounts;
                    const orderedParties = Object.keys(displayCounts).sort((a, b) => displayCounts[b] - displayCounts[a]);
                    const leadParty = orderedParties[0];
                    const runnerParty = orderedParties[1];
                    const indColour = config.partyColours.I ? (config.partyColours.I.default || config.partyColours.I.D || config.partyColours.I.R) : null;
                    const baseColour = leadParty === "I" ? (indColour || { h: 272, s: 78, l: 48 }) : config.partyColours[leadParty];

                    const totalProj = displayCounts.D + displayCounts.R + displayCounts.I;
                    const marginDiff = Math.abs(displayCounts[leadParty] - displayCounts[runnerParty]);
                    
                    // Margin for House
                    const margin = totalProj > 0 ? (marginDiff / totalProj) : 0;

                    if(displayCounts[leadParty] === displayCounts[runnerParty] && totalProj > 0)
                        newColour = stringifyColour(config.partyColours.HouseTie);
                    else if (totalProj === 0) 
                        newColour = resultColour; 
                    else if(electionType === "usHouse" && projected) {
                        newColour = stringifyColour({ h: baseColour.h, s: Math.max(88, safeNum(baseColour.s, 100)), l: Math.min(36, safeNum(baseColour.l, 36)) });
                    } else {
                        newColour = getMarginBucketColour(baseColour, margin);
                    }
                } else if (electionType === "usSenatePol") {
                     if(currentDistrict.senior.extendedAttribs.party === currentDistrict.junior.extendedAttribs.party){
                        newColour = stringifyColour(getPoliticianColour(currentDistrict.senior));
                    } else {
                        const seniorAcronym = (currentDistrict.senior.extendedAttribs.party === "Independent")
                            ? ("I" + currentDistrict.senior.caucusParty.charAt(0))
                            : currentDistrict.senior.caucusParty.charAt(0);
                        const juniorAcronym = (currentDistrict.junior.extendedAttribs.party === "Independent")
                            ? ("I" + currentDistrict.junior.caucusParty.charAt(0))
                            : currentDistrict.junior.caucusParty.charAt(0);
                        newColour = `url(#${seniorAcronym}:${juniorAcronym})`;
                    }
                } else if (electionType === "governorPol") {
                    newColour = stringifyColour(getPoliticianColour(currentDistrict));
                } else if(isPrimaryDistrict(currentDistrict)) {
                    newColour = electionType === "president"
                        ? resultColour
                        : getPrimaryReportingHexColour(getPrimaryReportingPercent(currentDistrict, live));
                } else if(projected) {
                    /* Projected Maps Logic */
                    raceInfo = getRaceInfo(currentDistrict, live);
                    const raceProjected = currentDistrict.pW === true
                        || currentDistrict.projected === true
                        || currentDistrict.final === true
                        || !live
                        || (Array.isArray(currentDistrict.cands) && currentDistrict.cands.some(candidateHasWinFlag));
                    
                    let isGain = isFlippedStateRace(electionType, stateId, currentDistrict, live);

                    if (isGain) {
                        const fillId = getPartyKey(raceInfo.finalWinner || raceInfo.currentLeader) + ":gain";
                        newColour = `url(#${fillId})`;
                    } else {
                        if (raceProjected) {
                             newColour = stringifyColour(getCandidateColour(raceInfo.finalWinner || raceInfo.currentLeader));
                        } else if (live && safeNum(currentDistrict.totalCurrVotes) > 0) {
                             newColour = stringifyColour({ h: 51, s: 20, l: 63 });
                        }
                        else if (!live && raceInfo.leaderVotes > 0) {
                             newColour = stringifyColour(getCandidateColour(raceInfo.currentLeader));
                        } else {
                             newColour = resultColour;
                        }
                    }

                } else {
                    /* General / Live Map Logic */
                    raceInfo = raceInfoCache[stateId];
                    if(raceInfo === undefined || raceInfo.leaderVotes === 0) {
                        newColour = resultColour;
                    } else {
                        if(isFlippedStateRace(electionType, stateId, currentDistrict, live)){
                            newColour = `url(#${getPartyKey(raceInfo.finalWinner || raceInfo.currentLeader)}:gain)`;
                        } else {
                            const baseColour = getCandidateColour(raceInfo.currentLeader);
                            newColour = getMarginBucketColour(baseColour, raceInfo.currentMargin);
                        }
                    }
                }

                d3.select("#" + stateId + "-state-path" + (live ? "-live" : ""))
                    .style("fill", newColour);
            } else d3.select("#" + stateId + "-state-path" + (live ? "-live" : ""))
                .style("fill", resultColour);
        });
    };

    const updateCountyMap = (svgMap, electionType, live) => {
        /* COUNTY-SHIFT MUNICIPALITY MODE */
        if(isShiftMunicipalityState(activeMap)){
            const paths = svgMap.getElementsByClassName("better-maps-state-path");
            for(let i = 0; i < paths.length; i++){
                const pathElem = paths[i];
                pathElem.style.transition = "fill 0.65s ease-in-out, opacity 0.45s ease-in-out, stroke 0.45s ease-in-out";
                const muniId = getShiftMunicipalityId(pathElem.getAttribute("id"));
                const syntheticDistrict = getMunicipalitySyntheticDistrict(muniId, electionType, live);

                if(!syntheticDistrict){
                    pathElem.style.fill = "#202734";
                    continue;
                }

                const raceInfo = getRaceInfo(syntheticDistrict, live);
                const totalVotes = live ? syntheticDistrict.totalCurrVotes : syntheticDistrict.totalVotes;
                const margin = totalVotes > 0 ? raceInfo.currentLead / totalVotes : 0;
                const baseColour = getCandidateColour(raceInfo.currentLeader);

                pathElem.style.fill = getMarginBucketColour(baseColour, margin);
            }
            return;
        }
        const currentOrigCounties = resultProxies[electionType][activeMap].counties;
        const newCounties = [];
        const stateElectData = allStElectData.filter(electData => (electData.id === activeMap))[0];
        const raceInfoCache = {};

        /* Process Counties */
        currentOrigCounties.forEach(origCounty => {
            let totalCurrVotes = 0;
            let totalVotes = 0;
            let caucusNum = { D: 0, R: 0 };

            const newCounty = {
                name: origCounty.name,
                cands: origCounty.cands.map(candObj => {
                    const newCandObj = Object.assign({}, candObj);
                    newCandObj.caucusCandNum = caucusNum[candObj.caucus];
                    caucusNum[candObj.caucus]++;

                    if(!live){
                        newCandObj.currentVotes = newCandObj.votes;
                    } else {
                        const countyElectData = stateElectData.counties.filter(candCountyData => (candCountyData.name === origCounty.name))[0];
                        newCandObj.currentVotes = (newCandObj.votes * candObj.updates[countyElectData.indx]);
                    }
                    totalCurrVotes += newCandObj.currentVotes;
                    totalVotes += newCandObj.votes;
                    return newCandObj;
                })
            };

            newCounty.totalCurrVotes = totalCurrVotes;
            newCounty.totalVotes = totalVotes;
            newCounties.push(newCounty);

            raceInfoCache[newCounty.name] = getRaceInfo(newCounty, live);

            const totalForCalc = live ? totalCurrVotes : totalVotes;
            
            // Calculate Margin for County
            const margin = totalForCalc > 0 
                ? raceInfoCache[newCounty.name].currentLead / totalForCalc 
                : 0;

            raceInfoCache[newCounty.name].currentMargin = margin;
        });

        /* Apply Colors */
        newCounties.forEach(county => {
            const raceInfo = raceInfoCache[county.name];
            let baseColour = getCandidateColour(raceInfo.currentLeader);

            if(raceInfo.currentLeader.caucusCandNum !== 0){
                const colourIndex = (raceInfo.currentLeader.caucusCandNum - 1) % config.alternateCaucusCountyColours[raceInfo.currentLeader.caucus].length;
                baseColour = config.alternateCaucusCountyColours[raceInfo.currentLeader.caucus][colourIndex];
            }

            /* Apply the Margin Bucket Logic */
            const newColour = (raceInfo.leaderVotes > 0)
                ? getMarginBucketColour(baseColour, raceInfo.currentMargin)
                : stringifyColour({ h: baseColour.h, s: 35, l: 88 });

            const croppedCountyName = county.name.substring(0, county.name.lastIndexOf(" "));
            const replacedFullName = county.name.toLowerCase().replace(/ /g, "_").replace(/\./g, "");
            const replacedCroppedName = croppedCountyName.toLowerCase().replace(/ /g, "_").replace(/\./g, "");

            if(document.getElementById(replacedFullName + "-state-path" + (live ? "-live" : ""))){
                d3.select("#" + replacedFullName + "-state-path" + (live ? "-live" : ""))
                    .style("transition", "fill 0.65s ease-in-out, opacity 0.45s ease-in-out, stroke 0.45s ease-in-out")
                    .style("fill", newColour);
            } else d3.select("#" + replacedCroppedName + "-state-path" + (live ? "-live" : ""))
                .style("transition", "fill 0.65s ease-in-out, opacity 0.45s ease-in-out, stroke 0.45s ease-in-out")
                .style("fill", newColour);
        });
    };

    /* Standard Pattern Functions */
    const createHatchPattern = (backColour, foreColour) => {
        const mainPatternElem = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
        mainPatternElem.setAttribute("width", "10"); mainPatternElem.setAttribute("height", "10");
        mainPatternElem.setAttribute("patternTransform", "rotate(45 0 0)");
        mainPatternElem.setAttribute("patternUnits", "userSpaceOnUse");

        const backRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        backRect.setAttribute("x", "0"); backRect.setAttribute("y", "0");
        backRect.setAttribute("width", "10"); backRect.setAttribute("height", "10");
        backRect.setAttribute("fill", backColour);
        mainPatternElem.appendChild(backRect);

        const hatchLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        hatchLine.setAttribute("x1", "0"); hatchLine.setAttribute("y1", "0");
        hatchLine.setAttribute("x2", "0"); hatchLine.setAttribute("y2", "10");
        hatchLine.setAttribute("style", `stroke: ${foreColour}; stroke-width: 8;`);
        mainPatternElem.appendChild(hatchLine);
        return mainPatternElem;
    };

    const createPartyPattern = (party1, party2) => {
        const partyCol1 = (party1.charAt(0) === "I") ? (config.partyColours.I[party1.charAt(1)]) : (config.partyColours[party1.charAt(0)]);
        const partyCol2 = (party2.charAt(0) === "I") ? (config.partyColours.I[party2.charAt(1)]) : (config.partyColours[party2.charAt(0)]);
        const pattern = createHatchPattern(stringifyColour(partyCol1), stringifyColour(partyCol2));
        pattern.setAttribute("id", party1 + ":" + party2);
        return pattern;
    };

    const createGainPattern = (party) => {
        const partyCol = (party.charAt(0) === "I") ? (config.partyColours.I[party.charAt(1)] || config.partyColours.I.default) : (config.partyColours[party.charAt(0)]);
        const partyColDarker = Object.assign({}, partyCol);
        partyColDarker.l = Math.max(partyCol.l - 10, 0);
        const pattern = createHatchPattern(stringifyColour(partyCol), stringifyColour(partyColDarker));
        pattern.setAttribute("id", party + ":gain");
        return pattern;
    };

    const createCrossHatches = (svgElem) => {
        svgElem.appendChild(createPartyPattern("D", "R"));
        svgElem.appendChild(createPartyPattern("R", "D"));
        svgElem.appendChild(createPartyPattern("D", "ID"));
        svgElem.appendChild(createPartyPattern("D", "IR"));
        svgElem.appendChild(createPartyPattern("R", "ID"));
        svgElem.appendChild(createPartyPattern("R", "IR"));
        svgElem.appendChild(createPartyPattern("ID", "D"));
        svgElem.appendChild(createPartyPattern("ID", "R"));
        svgElem.appendChild(createPartyPattern("IR", "D"));
        svgElem.appendChild(createPartyPattern("IR", "R"));
        svgElem.appendChild(createPartyPattern("ID", "IR"));
        svgElem.appendChild(createPartyPattern("IR", "ID"));
        svgElem.appendChild(createGainPattern("D"));
        svgElem.appendChild(createGainPattern("R"));
        svgElem.appendChild(createGainPattern("I"));
        svgElem.appendChild(createGainPattern("ID"));
        svgElem.appendChild(createGainPattern("IR"));
    };

    const getCanvasDimension = (canvasElem, attrName, fallback) => {
        const attrValue = canvasElem.getAttribute(attrName);
        const parsedAttr = attrValue ? parseFloat(attrValue) : NaN;
        if(Number.isFinite(parsedAttr) && parsedAttr > 0) return parsedAttr;
        const propValue = canvasElem[attrName];
        const parsedProp = parseFloat(propValue);
        if(Number.isFinite(parsedProp) && parsedProp > 0) return parsedProp;
        const rect = canvasElem.getBoundingClientRect ? canvasElem.getBoundingClientRect() : null;
        const rectValue = rect ? (attrName === "width" ? rect.width : rect.height) : NaN;
        if(Number.isFinite(rectValue) && rectValue > 0) return rectValue;
        const clientValue = attrName === "width" ? canvasElem.clientWidth : canvasElem.clientHeight;
        return Number.isFinite(clientValue) && clientValue > 0 ? clientValue : fallback;
    };

    const getModeButtonIds = (live) => ({
        project: live ? "betterMapsENightProjectB" : "betterMapsEPageProjectB",
        margin: live ? "betterMapsENightMarginB" : "betterMapsEPageMarginB",
        projectActive: live ? "eNightProjectBActive" : "ePageProjectBActive",
        marginActive: live ? "eNightMarginBActive" : "ePageMarginBActive"
    });

    const setModeButtonVisibility = (button, visible) => {
        if(!button) return;
        const toolbar = button.parentElement && button.parentElement.classList
            && button.parentElement.classList.contains("better-maps-mode-toolbar")
            ? button.parentElement
            : null;
        if(visible){
            button.style.removeProperty("display");
            if(String(button.getAttribute("style") || "").trim() === "") button.removeAttribute("style");
            if(toolbar) toolbar.style.removeProperty("display");
        } else {
            button.style.setProperty("display", "none", "important");
            if(toolbar) toolbar.style.setProperty("display", "none", "important");
        }
    };

    const ensureMapModeButtons = (container, canvasElem, resultColours, electionType, live, onClickPageFunc, hideButtons) => {
        if(container && container.style) container.style.setProperty("position", "relative");
        const ids = getModeButtonIds(live);
        const modeEligible = electionType === "president" || electionType === "usSenate"
            || electionType === "governor" || electionType === "usHouse";
        const getButtonsById = (id) => Array.from(document.querySelectorAll(`[id="${id}"]`));
        const removeEmptyToolbars = () => {
            Array.from(container.querySelectorAll(".better-maps-mode-toolbar")).forEach(toolbar => {
                if(!toolbar.querySelector("button")) toolbar.remove();
            });
        };
        const removeModModeButtons = () => {
            getButtonsById(ids.project).concat(getButtonsById(ids.margin)).forEach(button => {
                if(button.getAttribute("data-better-maps-mode-button") === "true") button.remove();
            });
            removeEmptyToolbars();
        };

        if(!modeEligible){
            removeModModeButtons();
            return;
        }

        let projectButton = document.getElementById(ids.project);
        let marginButton = document.getElementById(ids.margin);

        if(projectButton && projectButton.getAttribute("data-better-maps-mode-button") === "true"
            && projectButton.getAttribute("data-better-maps-live") !== String(live)){
            projectButton.remove();
            projectButton = null;
        }
        if(marginButton && marginButton.getAttribute("data-better-maps-mode-button") === "true"
            && marginButton.getAttribute("data-better-maps-live") !== String(live)){
            marginButton.remove();
            marginButton = null;
        }

        const createModeButton = (id, className, label) => {
            const button = document.createElement("button");
            button.setAttribute("id", id);
            button.setAttribute("class", className);
            button.textContent = label;
            button.setAttribute("data-better-maps-mode-button", "true");
            button.setAttribute("data-better-maps-live", String(live));
            return button;
        };
        if(!projectButton) projectButton = createModeButton(ids.project, ids.projectActive, "Projections");
        if(!marginButton) marginButton = createModeButton(ids.margin, ids.margin, "Margins");
        if(!projectButton.getAttribute("class")) projectButton.setAttribute("class", ids.projectActive);
        if(!marginButton.getAttribute("class")) marginButton.setAttribute("class", ids.margin);

        projectButton.onclick = () => {
            playClick();
            projectButton.setAttribute("class", ids.projectActive);
            marginButton.setAttribute("class", ids.margin);
            renderMap(canvasElem, resultColours, electionType, live, onClickPageFunc, true);
        };
        marginButton.onclick = () => {
            playClick();
            projectButton.setAttribute("class", ids.project);
            marginButton.setAttribute("class", ids.marginActive);
            renderMap(canvasElem, resultColours, electionType, live, onClickPageFunc, false);
        };

        if(projectButton.getAttribute("data-better-maps-mode-button") === "true"
            || marginButton.getAttribute("data-better-maps-mode-button") === "true"){
            let toolbar = container.querySelector(".better-maps-mode-toolbar");
            if(!toolbar){
                toolbar = document.createElement("div");
                toolbar.setAttribute("class", "better-maps-mode-toolbar");
                const firstFrame = container.querySelector(".better-maps-frame");
                const anchor = firstFrame || canvasElem || container.firstChild;
                if(anchor) container.insertBefore(toolbar, anchor);
                else container.appendChild(toolbar);
            }
            toolbar.setAttribute("data-better-maps-election-type", electionType);
            if(projectButton.parentElement !== toolbar) toolbar.appendChild(projectButton);
            if(marginButton.parentElement !== toolbar) toolbar.appendChild(marginButton);
        }
        removeEmptyToolbars();

        setModeButtonVisibility(projectButton, !hideButtons);
        setModeButtonVisibility(marginButton, !hideButtons);
    };

    const replayNativeCanvasClick = (canvasElem, svgMap, event) => {
        if(!canvasElem || !svgMap || typeof canvasElem.dispatchEvent !== "function" || !event) return;
        const frame = svgMap.parentElement;
        const width = svgMap.getAttribute("width") || canvasElem.getAttribute("width") || canvasElem.width || 800;
        const height = svgMap.getAttribute("height") || canvasElem.getAttribute("height") || canvasElem.height || 600;
        const previousStyle = canvasElem.getAttribute("style");
        try {
            canvasElem.style.setProperty("display", "block", "important");
            canvasElem.style.setProperty("position", "absolute", "important");
            canvasElem.style.setProperty("left", frame ? `${frame.offsetLeft || 0}px` : "0px", "important");
            canvasElem.style.setProperty("top", frame ? `${frame.offsetTop || 0}px` : "0px", "important");
            canvasElem.style.setProperty("width", `${parseFloat(width) || 800}px`, "important");
            canvasElem.style.setProperty("height", `${parseFloat(height) || 600}px`, "important");
            canvasElem.style.setProperty("opacity", "0", "important");
            canvasElem.style.setProperty("pointer-events", "none", "important");
            canvasElem.style.setProperty("z-index", "-1", "important");
            const clickEvent = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: event.clientX,
                clientY: event.clientY,
                screenX: event.screenX,
                screenY: event.screenY
            });
            canvasElem.dispatchEvent(clickEvent);
        } catch(err) {
        } finally {
            if(previousStyle === null) canvasElem.removeAttribute("style");
            else canvasElem.setAttribute("style", previousStyle);
        }
    };

    /* Rendering Functions */
    const renderMap = (canvasElem, resultColours, electionType, live, onClickPageFunc, projected) => {
        const container = canvasElem.parentElement;
        if(container && container.classList) container.classList.add("better-maps-map-shell");
        let svgMap = document.getElementById(electionType + "-map" + (live ? "-live" : ""));
        const modeIds = getModeButtonIds(live);

        let isProjected = (projected === undefined) ? false : projected;
        if(document.getElementById(modeIds.project)){
            isProjected = document.getElementById(modeIds.project).getAttribute("class") === modeIds.projectActive;
        }

        if(lastUpdateDataHook !== null) {
            Executive.functions.deregisterPostHook("electNightUpdateData", lastUpdateDataHook);
            lastUpdateDataHook = null;
        }

        if(electionType !== lastMapElectionType) {
            onCountyMap = false;
            onHouseDistrictMap = false;
        }
        lastMapElectionType = electionType;

        const houseHexStateId = (electionType === "usHouse" && onHouseDistrictMap && activeMap) ? String(activeMap).toLowerCase() : null;
        const isHouseHexMap = electionType === "usHouse" && !!houseHexStateId;
        const isCompositionMap = electionType === "compositionPol" || electionType === "usHousePol" || electionType === "governorPol" || electionType === "usSenatePol";
        let mapPath = Executive.mods.getRelativePathPrefix() + path.sep + "data" + path.sep +
            ((electionType === "president") ? "presidential.svg" : "states.svg");
        if(isHouseHexMap) mapPath = "generated-house-hexes-" + houseHexStateId;

        if(onCountyMap){
            if(!resultProxies[electionType][activeMap]) onCountyMap = false;
            else if(!resultProxies[electionType][activeMap].cands) onCountyMap = false;
            else if(resultProxies[electionType][activeMap].totalCurrVotes !== undefined
                && resultProxies[electionType][activeMap].totalCurrVotes === 0) onCountyMap = false;
        }

        if(onCountyMap){
            const countyMapPath = Executive.mods.getRelativePathPrefix() + path.sep + "data" + path.sep + "counties" + path.sep +
                activeMap.toLowerCase() + ".svg";
            if(fs.existsSync(countyMapPath)) mapPath = countyMapPath;
            else onCountyMap = false;
        }

        ensureMapModeButtons(container, canvasElem, resultColours, electionType, live, onClickPageFunc, onCountyMap && electionType !== "usHouse");
        const modeButton = document.getElementById(modeIds.project);
        if(modeButton){
            isProjected = modeButton.getAttribute("class") === modeIds.projectActive;
        }

        const removeReturnButtons = () => {
            Array.from(container.querySelectorAll(".better-maps-return-button, #eNightReturnB, #ePageReturnB, #ePageReturnB2"))
                .forEach(button => button.remove());
        };

        if(onCountyMap || isHouseHexMap){
            if(container && container.classList) container.classList.add("better-maps-has-return");
            removeReturnButtons();
            const returnButtonId = live ? "eNightReturnB" : (isHouseHexMap ? "ePageReturnB" : "ePageReturnB2");
            const returnButton = document.createElement("button");
            returnButton.setAttribute("id", returnButtonId);
            returnButton.textContent = isHouseHexMap ? "Return to U.S. House Map" : "Return to U.S. Map";
            returnButton.setAttribute("class", "better-maps-return-button");
            returnButton.onclick = () => {
                playClick();
                onCountyMap = false;
                onHouseDistrictMap = false;
                tooltipDiv.style.display = "none";
                tooltipComponents.properties.visible = false;
                tooltipComponents.properties.targetDistrict = null;
                onClickPageFunc();
            };
            if(container.firstChild) container.insertBefore(returnButton, container.firstChild);
            else container.appendChild(returnButton);
        } else {
            if(container && container.classList) container.classList.remove("better-maps-has-return");
            removeReturnButtons();
        }

        if(!svgMap || svgMap.getAttribute("data-type") !== electionType || svgMap.getAttribute("data-source") !== mapPath){
            const origWidth = getCanvasDimension(canvasElem, "width", 800);
            const origHeight = getCanvasDimension(canvasElem, "height", 600);

            const mapDataText = isHouseHexMap ? "" : fs.readFileSync(mapPath, "utf8");
            const mapData = isHouseHexMap ? null : (new DOMParser()).parseFromString(mapDataText, "image/svg+xml");

            if(svgMap && (svgMap.getAttribute("data-type") !== electionType || svgMap.getAttribute("data-source") !== mapPath)){
                const oldFrame = svgMap.parentElement;
                if(oldFrame && oldFrame.classList && oldFrame.classList.contains("better-maps-frame")) oldFrame.remove();
                else svgMap.remove();
                svgMap = null;
            }

            {
                svgMap = isHouseHexMap ? buildHouseHexSvg(origWidth, origHeight, houseHexStateId) : mapData.documentElement;
                const baseWidth = +svgMap.getAttribute("width");
                const baseHeight = +svgMap.getAttribute("height");
                const containerDiv = document.createElement("div");
                const canvasStyle = window.getComputedStyle ? window.getComputedStyle(canvasElem) : null;
                const floatStyle = canvasStyle && canvasStyle.float && canvasStyle.float !== "none"
                    ? `float: ${canvasStyle.float};`
                    : (isInsideElementId(canvasElem, "eSimMapDivRel") || isInsideElementId(canvasElem, "eSimMapDiv") ? "float: left;" : "display: inline-block; vertical-align: top;");
                const marginStyle = canvasStyle
                    ? `margin: ${canvasStyle.marginTop} ${canvasStyle.marginRight} ${canvasStyle.marginBottom} ${canvasStyle.marginLeft};`
                    : "";

                svgMap.setAttribute("id", electionType + "-map" + (live ? "-live" : ""));
                svgMap.setAttribute("class", "better-maps-container")
                svgMap.setAttribute("width", origWidth);
                svgMap.setAttribute("height", origHeight);
                svgMap.setAttribute("data-type", electionType);
                svgMap.setAttribute("data-source", mapPath);

                if(config.mapBackground){
                    const currentColour = config.mapBackgroundColours[Executive.styles.currentTheme];
                    svgMap.setAttribute("style", `background: hsl(${currentColour.h}, ${currentColour.s}%, ${currentColour.l}%)`);
                }

                containerDiv.appendChild(svgMap);
                containerDiv.setAttribute("class", "better-maps-frame");
                containerDiv.setAttribute("style", `width: ${origWidth}px; height: ${origHeight}px; overflow: hidden; line-height: 0; ${floatStyle} ${marginStyle}`);
                container.insertBefore(containerDiv, canvasElem);
                canvasElem.setAttribute("style", "display: none;");

                createCrossHatches(svgMap);

                const scaleFactor = Math.min(origWidth / baseWidth, origHeight / baseHeight);
                const outlineGroup = svgMap.getElementsByTagName("g")[0];
                const statePaths = outlineGroup.children;

                for(let i = 0; i < statePaths.length; i++){
                    if(isHouseHexMap && !statePaths[i].getAttribute("data-hex-id")) continue;
                    const stateId = statePaths[i].getAttribute("id");
                    const stateKey = String(stateId || "").toLowerCase();
                    statePaths[i].setAttribute("id", stateKey + "-state-path" + (live ? "-live" : ""));
                    statePaths[i].setAttribute("class", isHouseHexMap ? "better-maps-state-path better-maps-house-hex" : "better-maps-state-path");
                    const transitionStyle = isHouseHexMap
                        ? "transition: fill 0.55s ease-in-out, opacity 0.35s ease-in-out, stroke 0.25s ease-in-out, transform 180ms cubic-bezier(.2,1.35,.32,1);"
                        : "transition: fill 0.65s ease-in-out, opacity 0.45s ease-in-out, stroke 0.45s ease-in-out;";
                    statePaths[i].setAttribute("style", `fill: #cccccc; ${transitionStyle} ${config.mapBorders ? "stroke: #ffffff; stroke-opacity: 0.6; stroke-width: 0.8px" : ""}`);

                    if(!onCountyMap){
                        statePaths[i].addEventListener("click", (event) => {
                            playClick();
                            const clickedState = isHouseHexMap ? String(statePaths[i].getAttribute("data-state") || "").toLowerCase() : stateKey;
                            activeMap = clickedState.toUpperCase();
                            activeCampMap = Executive.data.states[clickedState];
                            if(isCompositionMap){
                                tooltipDiv.style.display = "none";
                                tooltipComponents.properties.visible = false;
                                tooltipComponents.properties.targetDistrict = null;
                                replayNativeCanvasClick(canvasElem, svgMap, event);
                            } else if(electionType === "usHouse" && !isHouseHexMap){
                                const selectedHouseState = resultProxies.usHouse[clickedState];
                                onHouseDistrictMap = !!(selectedHouseState && selectedHouseState.districts && selectedHouseState.districts.length > 0);
                                tooltipDiv.style.display = "none";
                                tooltipComponents.properties.visible = false;
                                tooltipComponents.properties.targetDistrict = null;
                            } else if(electionType !== "usHouse" && electionType !== "usHousePol"
                                && electionType !== "governorPol" && electionType !== "usSenatePol"){
                                onCountyMap = true;
                                tooltipDiv.style.display = "none";
                                tooltipComponents.properties.visible = false;
                                tooltipComponents.properties.targetDistrict = null;
                            }
                            onClickPageFunc();
                            if(isCompositionMap && typeof requestAnimationFrame === "function"){
                                requestAnimationFrame(() => onClickPageFunc());
                            }
                        });
                    }

                    if(!isCompositionMap){
                        
                        statePaths[i].addEventListener("mousemove", (event) => {
                            tooltipComponents.properties.visible = true;
                            const tooltipId = isHouseHexMap ? statePaths[i].getAttribute("data-hex-id") : stateId.toLowerCase();
                            tooltipComponents.properties.targetDistrict = tooltipId;
                            updateTooltip(electionType, tooltipId, false, live, onCountyMap);
                            tooltipDiv.style.display = "block";
                            tooltipDiv.classList.add("is-visible");
                            moveTooltipSmoothly(event);
                        });
    
                        statePaths[i].addEventListener("mouseleave", (event) => {
                            tooltipDiv.classList.remove("is-visible");
                            setTimeout(() => {
                                if(tooltipComponents.properties.visible === false) tooltipDiv.style.display = "none";
                            }, 140);
                            tooltipComponents.properties.visible = false;
                            tooltipComponents.properties.targetDistrict = null;
                        });
                    }
                }

                if(isHouseHexMap){
                    updateHouseHexMap(svgMap, live, isProjected);
                } else if(!fitOutlineGroupToViewport(svgMap, outlineGroup, origWidth, origHeight)){
                    const preTransform = outlineGroup.getAttribute("transform");
                    if(scaleFactor === (origWidth / baseWidth)){
                        outlineGroup.setAttribute("transform", `${(preTransform === null ? "" : preTransform)} translate(0, ${(origHeight / 2) - ((baseHeight * scaleFactor) / 2)}) scale(${scaleFactor})`);
                    } else {
                        outlineGroup.setAttribute("transform", `${(preTransform === null ? "" : preTransform)} translate(${(origWidth / 2) - ((baseWidth * scaleFactor) / 2)}, 0) scale(${scaleFactor})`);
                    }
                }

                if(isHouseHexMap) updateHouseHexMap(svgMap, live, isProjected);
                else if(onCountyMap) updateCountyMap(svgMap, electionType, live);
                else updateMap(svgMap, resultColours, electionType, live, isProjected);
            };
        } else {
            if(isHouseHexMap) updateHouseHexMap(svgMap, live, isProjected);
            else if(onCountyMap) updateCountyMap(svgMap, electionType, live);
            else updateMap(svgMap, resultColours, electionType, live, isProjected);
        }

        if(live && electionType !== "usHousePol" && !isCompositionMap){
            lastUpdateDataHook = Executive.functions.registerPostHook("electNightUpdateData", () => {
                if(isHouseHexMap) updateHouseHexMap(svgMap, live, isProjected);
                if(tooltipComponents.properties.targetDistrict !== null)
                    updateTooltip(electionType, tooltipComponents.properties.targetDistrict, true, live, onCountyMap);
                
                checkAndShowProjections(electionType);
            });
        }

        if(tooltipComponents.properties.targetDistrict !== null)
            updateTooltip(electionType, tooltipComponents.properties.targetDistrict, true, live, onCountyMap);

        if(canvasElem){
            canvasElem.style.setProperty("display", "none", "important");
            canvasElem.style.setProperty("pointer-events", "none", "important");
        }
        if(svgMap){
            svgMap.style.setProperty("pointer-events", "auto", "important");
            const frame = svgMap.parentElement;
            if(frame && frame.classList && frame.classList.contains("better-maps-frame")){
                frame.style.setProperty("pointer-events", "auto", "important");
                frame.style.setProperty("position", "relative", "important");
                frame.style.setProperty("z-index", isCompositionMap ? "8" : "5", "important");
            }
        }
    };

    const newElectPageMap = (canvasElem, resultColours, arg2, electionType) => {
        Executive.mods.saveData.testProp = "This is another test.";
        if(electionType !== "usSenate" && electionType !== "usHouse"
            && electionType !== "governor" && electionType !== "president")
            return originalElectPageMap(canvasElem, resultColours, arg2, electionType);
        let onClickPageFunc = null;
        switch(electionType){
            case "usSenate": onClickPageFunc = senateElectPage; break;
            case "usHouse": onClickPageFunc = houseElectPage; break;
            case "governor": onClickPageFunc = governorElectPage; break;
            case "president":
                onClickPageFunc = () => {
                    renderMap(canvasElem, resultColours, electionType, false, onClickPageFunc, true, true);
                    updateStDetails();
                };
                break;
        }
        renderMap(canvasElem, resultColours, electionType, false, onClickPageFunc, ((electionType === "president") ? true : undefined));
    };

    const newElectNightMap = (canvasElem, resultColours, arg2, electionType) => {
        if(electionType !== "usSenate" && electionType !== "usHouse"
            && electionType !== "governor" && electionType !== "president")
            return originalElectNightMap(canvasElem, resultColours, arg2, electionType);
        let onClickPageFunc = null;
        switch(electionType){
            case "usSenate": onClickPageFunc = electNightUSSFunc; break;
            case "usHouse": onClickPageFunc = electNightUSHFunc; break;
            case "governor": onClickPageFunc = electNightGovFunc; break;
            case "president":
                onClickPageFunc = electNightPresFunc;
                if(electNightP.elections[0].cands === undefined) onClickPageFunc = electNightPPFunc;
                break;
        }
        renderMap(canvasElem, resultColours, electionType, true, onClickPageFunc);
    };

    const newSimUSCanvas = (canvasElem, resultColours, arg2) => {
        renderMap(canvasElem, resultColours, "president", false, presElectPage);
    };

    const isInsideElementId = (elem, id) => {
        let current = elem;
        while(current){
            if(current.id === id) return true;
            current = current.parentElement;
        }
        return false;
    };

    const restoreNativeCanvasMap = (canvasElem) => {
        if(!canvasElem || !canvasElem.parentElement) return;
        Array.from(canvasElem.parentElement.children || []).forEach(child => {
            if(child !== canvasElem && (
                (child.classList && child.classList.contains("better-maps-frame"))
                || (child.classList && child.classList.contains("better-maps-mode-toolbar"))
                || (child.classList && child.classList.contains("better-maps-return-button"))
                || (child.querySelector && child.querySelector(".better-maps-container"))
            )) child.remove();
        });
        canvasElem.style.display = "";
        tooltipDiv.style.display = "none";
        tooltipComponents.properties.visible = false;
        tooltipComponents.properties.targetDistrict = null;
    };

    const isCandidateDetailSummaryPage = (canvasElem) => {
        const parentText = canvasElem && canvasElem.parentElement
            ? String(canvasElem.parentElement.innerText || canvasElem.parentElement.textContent || "")
            : "";
        return /Delegates:|Republican Candidates|Democratic Candidates|View Poll Results|View Endorsements|Next Election\(s\)/.test(parentText);
    };

    const hasStateColourPayload = (resultColours) => {
        if(!resultColours || typeof resultColours !== "object") return false;
        return Object.keys(resultColours).some(key => !!stateHexAnchors[String(key || "").toLowerCase()]);
    };

    const inferSummaryMapElectionType = (canvasElem, arg2, arg3) => {
        const text = [
            arg2,
            arg3,
            canvasElem && canvasElem.parentElement ? canvasElem.parentElement.id : "",
            canvasElem && canvasElem.parentElement ? canvasElem.parentElement.className : ""
        ].map(value => String(value || "").toLowerCase()).join(" ");
        if(text.indexOf("senate") !== -1) return "usSenatePol";
        if(text.indexOf("house") !== -1 || text.indexOf("representative") !== -1) return "usHousePol";
        if(text.indexOf("governor") !== -1 || text.indexOf("state government") !== -1) return "governorPol";
        return "compositionPol";
    };

    const newSummaryNationMap = (canvasElem, resultColours, arg2, arg3) => {
        if(isCandidateDetailSummaryPage(canvasElem) || !hasStateColourPayload(resultColours)){
            restoreNativeCanvasMap(canvasElem);
            return originalSummaryNationMap(canvasElem, resultColours, arg2, arg3);
        }
        const electionType = inferSummaryMapElectionType(canvasElem, arg2, arg3);
        const refreshCompositionPage = () => {
            try {
                originalSummaryNationMap(canvasElem, resultColours, arg2, arg3);
            } catch(err) {}
            renderMap(canvasElem, resultColours, electionType, false, refreshCompositionPage);
        };
        try {
            try {
                originalSummaryNationMap(canvasElem, resultColours, arg2, arg3);
            } catch(err) {}
            renderMap(canvasElem, resultColours, electionType, false, refreshCompositionPage);
        } catch(err) {
            restoreNativeCanvasMap(canvasElem);
            return originalSummaryNationMap(canvasElem, resultColours, arg2, arg3);
        }
    };

    const createMapChangeObserver = (electionType) => () => {
        const projectButton = document.getElementById(getModeButtonIds(true).project);
        if(projectButton){
            const buttonObserver = new MutationObserver((mutationList, observer) => {
                for(const mutation of mutationList){
                    if(mutation.type === "attributes" && mutation.attributeName === "class"){
                        const svgMap = document.getElementById(electionType + "-map-live");
                        if(svgMap){
                            newElectNightMap(document.getElementById("electNightCanvas"), JSON.parse(svgMap.getAttribute("data-colours")), 0, electionType);
                        }
                    }
                }
            });
            buttonObserver.observe(projectButton, {attributes: true});
        }
    };

    const addPartyID = () => {
        if(activeMap === "US") return;
        let sidePaneContainer = document.getElementById("electPageInn2Gen");
        if(!sidePaneContainer) sidePaneContainer = document.getElementById("electPageInn2Pri");
        const titleParagraph = sidePaneContainer.getElementsByClassName("electNightInnP")[0];
        const state = Executive.data.states[activeMap.toLowerCase()];
        const partyIDContainer = document.createElement("p");
        partyIDContainer.setAttribute("class", "summaryInnTopPRight");
        const demSpan = document.createElement("span");
        demSpan.setAttribute("style", "color: hsl(210, 100%, 60%);");
        demSpan.innerText = "D: " + Math.round(state.demPop * 100).toString() + "%";
        partyIDContainer.appendChild(demSpan);
        const repSpan = document.createElement("span");
        repSpan.setAttribute("style", "color: hsl(0, 100%, 60%);");
        repSpan.innerText = " R: " + Math.round(state.repPop * 100).toString() + "%";
        partyIDContainer.appendChild(repSpan);
        const indNode = document.createTextNode(" I: " + Math.round(state.indPop * 100).toString() + "%")
        partyIDContainer.appendChild(indNode);
        titleParagraph.appendChild(partyIDContainer);
    };

    mod.init = () => {
        Executive.styles.registerStyle("styles/general.css");
        Executive.styles.registerThemeAwareStyle("styles/light.css", "styles/dark.css");
        const configText = fs.readFileSync(Executive.mods.getRelativePathPrefix() + path.sep + "config.json", "utf8");
        config = JSON.parse(configText);
        createTooltip();
        createAlertContainer(); // Inicializa o container de alertas
        
        Executive.functions.registerReplacement("electPageMap", newElectPageMap);
        Executive.functions.registerReplacement("electNightMap", newElectNightMap);
        Executive.functions.registerReplacement("eSimUSCanvas", newSimUSCanvas);
        Executive.functions.registerReplacement("summaryNationMap", newSummaryNationMap);
        Executive.functions.registerPostHook("electNightUSSFunc", createMapChangeObserver("usSenate"));
        Executive.functions.registerPostHook("electNightGovFunc", createMapChangeObserver("governor"));
        Executive.functions.registerPostHook("electNightPresFunc", createMapChangeObserver("president"));
        if(config.showPanePartyID === true){
            Executive.functions.registerPostHook("houseElectPage", addPartyID);
            Executive.functions.registerPostHook("senateElectPage", addPartyID);
            Executive.functions.registerPostHook("governorElectPage", addPartyID);
        }
        Executive.styles.onThemeChange.registerListener((eventObj, darkMode) => {
            if(config.mapBackground){
                const currentColour = config.mapBackgroundColours[Executive.styles.currentTheme];
                const currentContainers = document.getElementsByClassName("better-maps-container");
                for(let i = 0; i < currentContainers.length; i++){
                    currentContainers[i].setAttribute("style", `background: hsl(${currentColour.h}, ${currentColour.s}%, ${currentColour.l}%)`);
                }
            }
        });
    };

    module.exports = mod;
}
