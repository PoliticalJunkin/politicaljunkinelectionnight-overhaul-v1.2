/* Better Election Maps – better-maps/proxies.js
   Creates proxies for electNight<type> objects so they can be indexed by district ID. */

{
    const proxies = {};

    proxies.usSenate = new Proxy({}, {
        get: (target, property) => {
            const refinedList = electNightUSS.elections.filter(
                stateEntry => (stateEntry.state.toLowerCase() === property.toLowerCase()));
            if(refinedList.length === 0) return undefined;
            return refinedList[0];
        }
    });

    proxies.president = new Proxy({}, {
        get: (target, property) => {
            const refinedList = electNightP.elections.filter(
                stateEntry => (stateEntry.state.toLowerCase() === property.toLowerCase()));
            if(refinedList.length === 0) return undefined;
            return refinedList[0];
        }
    });

    proxies.governor = new Proxy({}, {
        get: (target, property) => {
            const refinedList = electNightG.elections.filter(
                stateEntry => (stateEntry.state.toLowerCase() === property.toLowerCase()));
            if(refinedList.length === 0) return undefined;
            return refinedList[0];
        }
    });

    proxies.usHouse = new Proxy({}, {
        get: (target, property) => {
            const refinedList = electNightUSH.elections.filter(
                districtEntry => (districtEntry.state.toLowerCase() === property.toLowerCase()));
            if(refinedList.length === 0) return undefined;

            let projectedDem = 0;
            let projectedRep = 0;
            let projectedInd = 0;

            refinedList.forEach(district => {
                if(district.cands === undefined) return;
                const projected = district.pW === true
                    || district.projected === true
                    || district.final === true
                    || district.cands.some(cand => cand && (cand.pW === true || cand.winner === true || cand.won === true || cand.projected === true || cand.final === true));
                if(!projected) return;

                const sortedCands = district.cands.slice().sort((cand1, cand2) => {
                    return cand2.votes - cand1.votes;
                });

                const winner = sortedCands[0];
                const winnerParty = (winner.party !== "I") ? winner.party : "I";

                if(winnerParty === "D") projectedDem++;
                else if(winnerParty === "R") projectedRep++;
                else projectedInd++;
            });

            return {
                districts: refinedList,
                projectedDem,
                projectedRep,
                projectedInd
            };
        }
    });

    proxies.usHousePol = new Proxy({}, {
        get: (target, property) => {
            const refinedList = Executive.data.politicians.usHouse[property.toLowerCase()];
            if(refinedList === undefined || refinedList.length === 0) return undefined;

            let projectedDem = 0;
            let projectedRep = 0;
            let projectedInd = 0;

            refinedList.forEach(incumbent => {
                const winnerParty = incumbent.caucusParty;

                if(winnerParty === "Democrat") projectedDem++;
                else if(winnerParty === "Republican") projectedRep++;
                else projectedInd++;
            });

            return {
                districts: refinedList,
                projectedDem,
                projectedRep,
                projectedInd
            };
        }
    });

    proxies.governorPol = Executive.data.politicians.governors;
    proxies.usSenatePol = Executive.data.politicians.usSenate;

    module.exports = proxies;
};
