'use strict';

const rp = require('request-promise'),
  $ = require('cheerio'),
  request = require('request'),
  moment = require('moment'),
  fs = require('fs'),
  _ = require('lodash');

const extractCookies = require('./util/extractCookies.js');

const LOGIN_COOKIE_FILENAME  = 'logincookie.json';
const USER_INFO_FILENAME  = 'user.json';

const MAX_TRIES = 900;

let commonInfo = {
  userId:undefined,
  flattenCookie: undefined
};

function persist(obj, filename) {
  fs.writeFileSync(filename, JSON.stringify(obj), 'utf8');
}

function getObjectFromFile(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  }
  catch(err) {
    return undefined;
  }

}


function requestFor(obj) {
  let baseConfig = {
    resolveWithFullResponse: true,
    encoding: 'binary'
  };

  let config = Object.assign(baseConfig, obj);

  return rp(config);
}

function requestForWithCookies(obj, flattenedCookies) {
  let cookie = request.cookie(flattenedCookies);
  let jar = request.jar();

  jar.setCookie(cookie, 'http://boxcheckin.com.br');

  let options = {
    jar: jar,
    resolveWithFullResponse: true,
    encoding: 'binary'
  };

  let config = Object.assign(options, obj);

  return rp(config);
}


const endpoints = {
  base: 'http://boxcheckin.com.br',
  login: 'Account/LogOn',
  profile: 'Perfil',
  checkInList: 'CheckIn/Index/?tipo_checkin=NOR',
  checkIn: 'Create/?id_horario=1470&dt=26/10/2016&tipo_checkin=NOR'
};

function login(user, password) {
  let data = {
    url: `${endpoints.base}/${endpoints.login}`,
    method: 'POST',
    form: {
      'UserName': user,
      'Password': password,
      'send': 'Entrar'
    },
    simple: false
  };

  console.log('step 1 - login');

  return requestFor(data)
    .then((result) => {
      console.log('step 1 - fim login', result.statusCode);
      if(result.complete && result.statusCode === 302) {
        return getCookiesFromHeader(result.headers);
      }

      else throw 'error on login';
    }).catch((err) => {
      console.log('error on login', err);
    });
}


function getCookiesFromHeader(headers) {
  if (_.isObject(headers)) {
    return extractCookies(headers['set-cookie']);
  }

  return {};
}

function openProfile(cookies) {
  let data = {
    url: `${endpoints.base}/${endpoints.profile}`,
    followAllRedirects: true,
    method: 'GET'
  };

  return requestForWithCookies(data, cookies).then((result) => {
    let url = result.req.path.split('/');

    let userId = url[url.length - 1];

    console.log('userid = ' + userId);

    return userId;
  });
}

function getAvailableCheckins() {
  let data = {
    url: `${endpoints.base}/${endpoints.checkInList}`,
    followAllRedirects: true,
    method: 'GET',
    transform: function(result) {
      return $.load(result);
    }
  };

  return requestForWithCookies(data, commonInfo.flattenCookie)
    .then((jq) => {
      let table = jq('table#dt_a tbody');

      let trs = $('tr', table);

      let result = [];
      _.each(trs, (row) => {
        let columns = $('td',row);

        if(columns.length >= 2) {
          result.push({
            hour: $(columns[1]).text(),
            link: $('a', columns[columns.length - 1]).attr('href')
          });
        }
      });

      return result;
    });
}

function checkIn(targetUrl) {
  let data = {
    url: `${endpoints.base}/${targetUrl}`,
    followAllRedirects: true,
    method: 'POST',
    form: {
      id_aluno: commonInfo.userId,
      data: moment().format('DD/MM/YYYY')
    }
  };

  return requestForWithCookies(data, commonInfo.flattenCookie).then((result) => {
    console.log('checkin done!');
  }).catch((err) => {
    console.log('fail to checkin');
  });
}


function loadPersisted() {
  let info = getObjectFromFile(LOGIN_COOKIE_FILENAME);
  if(!info || !info.userId || !info.flattenCookie) {
    return Promise.reject();
  }

  commonInfo = info;

  console.log('loaded info from file');

  return Promise.resolve();
};

//post com login para http://boxcheckin.com.br/Account/LogOn
/**
 * UserName:jjlameira@gmail.com
 Password:123456
 send:Entrar
 */

//para pegar o id do aluno, http://boxcheckin.com.br/Aluno/Edit/126

// get http://boxcheckin.com.br/CheckIn/Index/?tipo_checkin=NOR


/**
 * pegar a url do horario, para descobrir o id_horario e data
 * /CheckIn/Create/?id_horario=1470&dt=26/10/2016&tipo_checkin=NOR
 */

/**
 * post para CheckIn/Create/?id_horario=1470&dt=26/10/2016&tipo_checkin=NOR
 *
 * id_aluno:126
 token_gympass:
 * data:26/10/2016
 */

let userInfo = getObjectFromFile(USER_INFO_FILENAME);

if(!userInfo || !userInfo.login || !userInfo.password || !userInfo.target_hour)
{
  console.log('error on user info file read');
  return;
}

loadPersisted().catch(() => {
  return login(userInfo.login, userInfo.password)
    .then((result) => {
      let flattenedCookies = _.join(_.values({
        a:result['.ASPXAUTH'],
        b:result['ARRAffinity'],
        c:result['ASP.NET_SessionId']}), ';');

      commonInfo.flattenCookie = flattenedCookies;

      return flattenedCookies;
    })
    .then(openProfile)
    .then((result) => commonInfo.userId = result)
    .then(() => {
      persist(commonInfo, LOGIN_COOKIE_FILENAME);
    });
}).then(tryTocheckIn)
  .catch(() => {
    console.log('start to try between 500 seconds');
    var counter = 0, dismissed = false;

    return new Promise((resolve, reject) => {
      let intervalId = setInterval(() => tryTocheckIn().then(() => {
        clearInterval(intervalId);
        console.log('finished!gratz!');

        resolve();
      }).catch(() => {
        ++counter;

        console.log(`tried ${counter} times`);

        if(counter > MAX_TRIES) {
          if (!dismissed) {
            console.log(`tried ${MAX_TRIES} times. dismiss`);
            dismissed = true;
            clearInterval(intervalId);
          }

          resolve();
        }
      }), 1000);
    });
  }).then(() => {
  console.log('program finished.');

  process.exit(0);
});




function tryTocheckIn(){
  return getAvailableCheckins()
    .then((availableHours) => {
      let target = _.find(availableHours, (el) => el.hour === userInfo.target_hour);
      if(!target) {
        console.log('target hour not available');

        throw 'target hour not available';
      }
      return target.link;
    }).then(checkIn);
}