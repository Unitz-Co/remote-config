exports.getQuery = () => `
  query($user_id: String!, $advisor_id: String!, $purchase_id: uuid!) {
    user: user_by_pk(id: $user_id) {
      id
      profile {
        display_name
      }
    }
    advisor: advisor_by_pk(id: $advisor_id) {
      id
      profile {
        display_name
      }
    }
    purchase: purchase_by_pk(id: $purchase_id) {
      course_rooms {
        id
      }
      courses {
        pricing_type
        price_amount
        price_currency
        per_amount
        per_unit
        course {
          id
          name
          description
          start_at
          session_duration
          session_occurence
          sessions {
            id
            is_active
          }
          first_room: rooms(order_by: {start_at: asc}, limit: 1) {
            start_at
            id
          }
        }
      }
    }
  }
`;

exports.getVars = ({ payload }, { helpers: { _ } }) => {
  return {
    user_id: _.get(payload, 'purchase.user_id'),
    advisor_id: _.get(payload, 'course.advisor_id'),
    purchase_id: _.get(payload, 'purchase.id'),
  };
};

exports.dispatch = async ({ payload }, { ctxData, utils, helpers }) => {
  const { _ } = helpers;

  const course = _.get(ctxData, 'purchase.courses.0.course');
  const per_unit = _.get(ctxData, 'purchase.courses.0.per_unit');
  const per_amount = _.get(ctxData, 'purchase.courses.0.per_amount');
  const price_amount = _.get(ctxData, 'purchase.courses.0.price_amount');
  const price_currency = _.get(ctxData, 'purchase.courses.0.price_currency');

  const userDisplayName = _.get(ctxData, 'user.profile.display_name');
  const courseDisplayName = _.get(course, 'name');
  const advisor_id = _.get(ctxData, 'advisor.id');

  const i18n = await utils.forUser(advisor_id);

  // const title = `${userDisplayName} đã mua khoá học ${courseDisplayName}.`;

  const title = i18n.t('RemoteConfig.Course.AdvisorCoursePurchase.title', {
    course: courseDisplayName,
    user: userDisplayName,
  });

  const body = i18n.t(
    `RemoteConfig.Course.Purchase.${['per_session', 'session'].includes(per_unit) ? '' : 'full_'}session`,
    {
      amount: helpers.formatCurrencySSR(price_amount, price_currency),
      per_amount,
    }
  );

  // ? `Thanh toán ${helpers.formatCurrencySSR(price_amount, price_currency)} cho ${per_amount} buổi`
  // : `Trọn gói: ${helpers.formatCurrencySSR(price_amount, price_currency)}`;

  return {
    notification: {
      // title: `Your booking #${bookingId} is completed`,
      title,
      body,
    },
    data: {
      type: 'advisor.course.purchase',
      purchase_id: _.get(payload, 'purchase.id'),
      sound: 'sound1',
    },
    apns: {
      payload: {
        aps: {
          alert: {
            title,
            body,
          },
          sound: 'notification.mp3',
        },
      },
    },
    android: {
      priority: 'high',
      data: {
        sound: 'notification',
        channelId: 'unitz-notifee-video-channel-2',
      },
      notification: {
        sound: 'notification',
        channelId: 'unitz-notifee-video-channel-2',
      },
    },
  };
};

exports.effect = async (
  { payload },
  { ctxData, utils, helpers, clients: { slackClient, hasuraClient, sendgridClient, routeWebClient } }
) => {
  const { _, moment } = helpers;

  const advisor_id = _.get(ctxData, 'advisor.id');
  const course = _.get(ctxData, 'purchase.courses.0.course');
  const per_unit = _.get(ctxData, 'purchase.courses.0.per_unit');
  const per_amount = _.get(ctxData, 'purchase.courses.0.per_amount');
  const price_amount = _.get(ctxData, 'purchase.courses.0.price_amount');

  const advisorDisplayName = routeWebClient.getClient().toAdminLink('admin.advisor', _.get(ctxData, 'advisor'));
  const userDisplayName = routeWebClient.getClient().toAdminLink('admin.user', _.get(ctxData, 'user'));
  const courseDisplayName = routeWebClient.getClient().toAdminLink('admin.course', course);

  const i18n = await utils.forUser(advisor_id);

  const $start_at = moment(_.get(course, 'start_at'));
  const session_count = _.get(course, 'session_occurence', 0);
  const session_duration = _.get(course, 'session_duration', 0);

  const first_session_start = moment(_.get(course, 'first_room.0.start_at'));
  const first_room = _.get(course, 'first_room.0');

  const per_session = parseInt(session_count) === 100000 ? '' : `/${session_count}`;
  const payment_count = ['per_session', 'session'].includes(per_unit)
    ? i18n.t('RemoteConfig.Course.Purchase.per_session', {
        session: `${per_amount}${per_session}`,
      })
    : i18n.t('RemoteConfig.Course.Purchase.full_session_txt');
  // `${per_amount}${per_session} buổi` : 'Trọn gói';

  // inapp noti effect
  hasuraClient.getClient().request(
    `
    mutation upsertnotifevent($payload: jsonb, $type: String) {
      insert_notification_one(
        object: {
          owner_id: "${advisor_id}"
          type_id: $type
          payload: $payload
        }
      ) {
        id
      }
    }
  `,
    {
      type: 'advisor.course.purchase',
      payload,
    }
  );

  const title = `${userDisplayName} đã mua khoá học "${courseDisplayName}" của ${advisorDisplayName}.`;
  const body = ['per_session', 'session'].includes(per_unit)
    ? `${per_amount} buổi: ${helpers.formatCurrencySSR(price_amount)}`
    : `Trọn gói: ${helpers.formatCurrencySSR(price_amount)}`;

  console.log('title', title, body);

  // slack message effect
  slackClient.getClient().postMessage({
    text: title,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'advisor.course.purchase',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: title,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: body,
          },
        ],
      },
      {
        type: 'divider',
      },
    ],
    // channel: 'C02P4M8KFBK',
  });

  // send email effect
  sendgridClient.getClient().sendEmail(advisor_id, {
    template: {
      name: i18n.getTemplateSuffixName('advisor.course.purchase'),
    },
    ...i18n.getContactEmailInfo('advisor.course.purchase'),
    ...ctxData,
    course: {
      ..._.pick(course, ['id', 'name']),
      first_session_start: _.capitalize(
        first_session_start
          .locale(i18n.locale)
          .utcOffset(await utils.getUserTimezone(advisor_id))
          .format(helpers.START_TIME_FULL_FORMAT)
      ),
      session_count: helpers.formatSessionOccurenceWithI18n(i18n)(session_count),
      session_duration: helpers.formatCallDurationWithI18n(i18n)(session_duration),
    },
    tuition: {
      amount: helpers.formatCurrencySSR(price_amount),
      payment_count,
    },
    route: {
      advisor_url: routeWebClient.getClient().toAdvisorUrl('home'),
      course_url: routeWebClient.getClient().toAdvisorUrl('courseDetail', course),
      advisor_calendar_url: routeWebClient.getClient().toAdvisorUrl('calendar', course),
      room_url: routeWebClient.getClient().toAdvisorUrl('room', first_room),
      add_course_url: routeWebClient.getClient().toAdvisorUrl('addCourse'),
    },
  });
};
