require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const redis = require('redis');
const { hashSync, genSaltSync, compareSync } = require('bcrypt');
const crypto = require('crypto');
const twilioSid = process.env.TWILIO_SID;
const twilioAuth = process.env.TWILIO_AUTH;
const twilioNo = process.env.TWILIO_NO;
const twilioClient = require('twilio')(twilioSid, twilioAuth);
const { check, validationResult } = require('express-validator');
const validatePhone = require('no-telp');

const app = express();

app.use(bodyParser.json());

const port = process.env.APP_PORT;
const redisPort = process.env.REDIS_PORT;
const redisHost = process.env.REDIS_HOST;

const redisClient = redis.createClient({
  host: redisHost,
  port: redisPort
});

redisClient.on('error', (err) => {
  console.log(`Could not Connect to Redis ${err}`);
});

redisClient.on('connect', () => {
  console.log('Redis Connected');
});

const generateOtp = (req, res) => {
  try {
    const phone = req.phone;
    const otp = crypto.randomInt(1000, 9999);
    console.log(`otp ${otp}`);
    const resend = req.resend;

    redisClient.set(`otp_${phone}`, otp,
      (err, reply) => {
        if (err) {
          console.log(err);
          res.status(400).json({
            message: err
          });
        }
        if (reply) {
          return true;
          // res.redirect(307, '/otp?phone='+phone);
        }
      });
  } catch (e) {
    console.log(e);
    res.status(400).json({
      message: e.message
    });
  }
}

const checkPhone = (req, res) => {
  try {
    const msg = validatePhone.getOperator(req.phone)

    if (msg.valid) {
      return true
    } else {
      return false
    }
  } catch (e) {
    console.log(e);
    res.status(400).json({
      message: e.message
    });
  }
}

app.get('/', (req, res) => {
  res.send('API-Verification OTP')
});

app.post('/register',
  check('phone')
    .isNumeric({ no_symbols: true })
    .withMessage('just numeric input')
    .isLength({ max: 13 })
    .withMessage('too long input'),
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('check register ', errors.array())
        return res.status(400).json({ errors: errors.array() });
      }

      const phone = req.body.phone;

      if (!phone) {
        res.status(400).json({
          message: 'Input phone number'
        });
      } else {
        if (checkPhone({phone: phone})) {
          twilioClient.lookups.v1.phoneNumbers(phone)
            .fetch({ type: ['carrier'] })
            .then(phone_number => {
              if (phone_number.carrier.error_code === null) {
                redisClient.set(`key_${phone}`, phone,
                (err, reply) => {
                  if (err) {
                    console.log(err);
                    res.status(400).json({
                        message: err
                      })
                    }
                    if (reply) {
                      try {
                        console.log(reply);
                        generateOtp({ phone: phone })
                        redisClient.get(`otp_${phone}`, (err, obj) => {
                          if (err) {
                            res.status(400).json({
                              message: err
                            });
                          } else {
                            twilioClient.messages
                              .create({
                                from: `whatsapp:${twilioNo}`, // whatsapp
                                // from: twilioNo, // sms
                                body: `Kode keamanan anda adalah ${obj}. Jangan bagikan kode anda kepada siapapun.`,
                                to: `whatsapp:${phone}`, // whatsapp
                                // to: `+${phone}`, // sms
                              })
                              .then(message => {
                                res.status(200).json({
                                  message: 'success',
                                  data: {
                                    phone: phone,
                                    otp: obj,
                                    resp_twilio: message
                                  }
                                });
                              })
                              .catch(e =>{
                                console.log(e);
                                res.status(400).json({
                                  message: e.message
                                });
                              })
                              .done();
                          }
                        });
                      } catch (e) {
                        console.log(e);
                        res.status(400).json({
                          message: e.message
                        });
                      }
                    }
                  });
              } else {
                let msg = `Cannot send OTP to +${phone}. Invalid phone number`
                res.status(400).json({
                  message: msg
                })
                console.log(msg);
              }
            })
            .catch(e =>{
              console.log(e);
              res.status(400).json({
                message: e.message
              });
            })
        } else {
          return res.status(400).json({
            message: `Cannot send OTP to +${phone}. Invalid phone number`
          })
        }
      }
    } catch (e) {
      console.log(e);
      res.status(400).json({
        message: e.message
      });
    }
  });

app.post('/otp',
  check('phone')
    .isNumeric({ no_symbols: true })
    .withMessage('just numeric input')
    .isLength({ max: 13 })
    .withMessage('too long input'),
  check('otp')
    .isLength({ min: 4, max: 4 })
    .withMessage('just enter 4 numbers')
    .isNumeric({ no_symbols: true })
    .withMessage('just numeric input'),
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('check otp ', errors.array())
        return res.status(400).json({ errors: errors.array() });
      }

      const phone = req.query.phone;
      const otp = req.body.otp;
      const resend = req.query.resend;

      if (resend) {
        if (checkPhone({phone: phone})) {
          generateOtp({ phone: phone });
          return redisClient.get(`otp_${phone}`, (err, obj) => {
            if (err) {
              res.status(400).json({
                message: err
              });
            } else {
              twilioClient.messages
                .create({
                  from: `whatsapp:${twilioNo}`, // whatsapp
                  // from: twilioNo, // sms
                  body: `Kode keamanan anda adalah ${obj}. Jangan bagikan kode anda kepada siapapun.`,
                  to: `whatsapp:${phone}`, // whatsapp
                  // to: `+${phone}`, // sms
                })
                .then(message => {
                  res.status(200).json({
                    message: 'success',
                    data: {
                      phone: phone,
                      otp: obj,
                      resp_twilio: message
                    }
                  });
                })
                .catch(e =>{
                  console.log(e);
                  res.status(400).json({
                    message: e.message
                  });
                })
                .done();
            }
          });
        } else {
          return res.status(400).json({
            message: `Cannot send OTP to +${phone}. Invalid phone number`
          })
        }
      }

      if (!phone) {
        res.status(400).json({
          message: 'invalid phone number'
        })
      } else {
        if (checkPhone({phone: phone})) {
          redisClient.get(`key_${phone}`, (err, obj) => {
            if (!obj || (obj != phone)) {
              res.status(400).json({
                message: 'Phone number not found',
                phone: obj
              });
            } else {
              if (!otp) {
                res.status(400).json({
                  message: 'OTP not found',
                  otp: obj
                });
              } else {
                redisClient.get(`otp_${phone}`, (err, obj) => {
                  if (!obj || (obj != otp)) {
                    res.status(400).json({
                      message: 'invalid OTP',
                      otp: obj
                    });
                  } else {
                    // res.redirect(307, '/set-password?phone='+phone);
                    res.status(200).json({
                      message: 'success',
                      data: {
                        phone: phone,
                        otp: obj
                      }
                    });
                  }
                });
              }
            }
          });
        } else {
          return res.status(400).json({
            message: `Cannot send OTP to +${phone}. Invalid phone number`
          })
        }
      }
    } catch (e) {
      console.log(e);
      res.status(400).json({
        message: e.message
      });
    }
  });

app.post('/set-password',
  check('phone')
    .isNumeric({ no_symbols: true })
    .withMessage('just numeric input')
    .isLength({ max: 13 })
    .withMessage('too long input'),
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('check set password ', errors.array())
        return res.status(400).json({ errors: errors.array() });
      }

      const phone = req.query.phone;
      let password = req.body.password;
      const rePassword = req.body.rePassword;

      if (!phone) {
        res.status(400).json({
          message: 'invalid phone number'
        })
      } else {
        if (checkPhone({phone: phone})) {
          redisClient.get(`key_${phone}`, (err, obj) => {
            if (!obj || (obj != phone)) {
              res.status(400).json({
                message: 'phone number not found'
              });
            }
            else {
              if (!password || !rePassword) {
                res.status(400).json({
                  message: 'input your password'
                });
              } else {
                if (password != rePassword) {
                  res.status(400).json({
                    message: 'password did not match'
                  });
                } else {
                  const salt = genSaltSync(10);
                  password = hashSync(password, salt);

                  redisClient.set(`pass_${phone}`, password,
                    (err, reply) => {
                      if (err) {
                        console.log(err);
                        res.status(400).json({
                          message: err
                        });
                      }
                      if (reply) {
                        console.log(reply);
                        res.status(200).json({
                          message: 'success',
                          data: {
                            phone: phone,
                            password: password
                          }
                        });
                      }
                    });
                }
              }
            }
          });
        } else {
          return res.status(400).json({
            message: `Cannot send OTP to +${phone}. Invalid phone number`
          })
        }
      }
    } catch (e) {
      console.log(e);
      res.status(400).json({
        message: e.message
      });
    }
  });

app.listen(port, () => {
  console.log(`listening at http://localhost:${port}`)
});