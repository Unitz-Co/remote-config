exports.getQuery = () => `
  query($user_id: String!, $advisor_id: String!, $room_id: uuid!, $course_id: uuid!) {
    advisor: advisor_by_pk(id: $advisor_id) {
      id
      profile {
        display_name
      }
    }
    user: user_by_pk(id: $user_id) {
      id
      profile {
        display_name
      }
    }
    room: course_room_by_pk(id: $room_id) {
      id
      start_at
      end_at
    }
    course: course_by_pk(id: $course_id) {
      id
      name
      start_at
      session_duration
      session_occurence
      sessions {
        id
        is_active
      }
      per_amount
      per_unit
      purchases(where: {purchase: {user_id: {_eq: $user_id}}}) {
        id
        price_amount
        is_active
        purchase {
          statement {
            amount
            id
          }
          user_id
        }
      }
    }
  }
`;

exports.getVars = ({ payload }, { helpers: { _ } }) => {
  return {
    advisor_id: _.get(payload, 'course.advisor_id'),
    course_id: _.get(payload, 'course.id'),
    room_id: _.get(payload, 'room.id'),
    user_id: _.get(payload, 'attendee_purchase.user_id'),
  };
};

exports.dispatch = async ({ payload }, { ctxData, helpers, utils, clients: { routeWebClient } }) => {
  const { _, moment } = helpers;

  const course = _.get(ctxData, 'course');
  const room = _.get(ctxData, 'room');
  const start_at = _.get(ctxData, 'room.start_at');
  const $now = moment();
  const diffMin = moment(start_at).diff($now, 'minute');

  const $start_at = moment(_.get(room, 'start_at'));
  const advisor_id = _.get(ctxData, 'advisor.id');

  const user_id = _.get(ctxData, 'user.id');
  const i18n = await utils.forUser(user_id);

  const courseDisplayName = `${_.get(course, 'name')}(${$start_at
    .utcOffset(await utils.getUserTimezone(advisor_id))
    .locale(i18n.locale)
    .format(helpers.START_TIME_FORMAT)})`;

  // const title = `Lớp học ${courseDisplayName}`;
  const title = i18n.t('RemoteConfig.Room.UserRoomReminder.title', {
    course: courseDisplayName,
  });
  const body = i18n.t('RemoteConfig.Room.UserRoomReminder.body', {
    diffMin,
  });
  // const body = `Sẽ bắt đầu sau ${diffMin} phút.`;

  return {
    notification: {
      title,
      body,
    },
    data: {
      type: 'user.room.reminder',
      room_id: _.get(room, 'id') || '',
      course_id: _.get(course, 'id') || '',
      room_url: routeWebClient.getClient().toUserUrl('room', room),
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
      },
      notification: {
        sound: 'notification',
      },
    },
  };
};

exports.effect = async ({ payload }, { ctxData, helpers, utils, clients }) => {
  const { _, moment } = helpers;

  const course = _.get(ctxData, 'course');
  const room = _.get(ctxData, 'room');

  const $start_at = moment(_.get(room, 'start_at'));
  const advisor_id = _.get(ctxData, 'advisor.id');
  const $now = moment();

  const diffMin = moment($start_at).diff($now, 'minute');
  const user_id = _.get(ctxData, 'user.id');
  const i18n = await utils.forUser(user_id);

  const session_at = _.capitalize(
    $start_at
      .locale(i18n.locale)
      .utcOffset(await utils.getUserTimezone(advisor_id))
      .format(helpers.START_TIME_FULL_FORMAT)
  );
  const session_count = _.get(ctxData, 'course.session_occurence', 0);
  const session_duration = _.get(ctxData, 'course.session_duration', 0);

  const per_unit = _.get(course, 'per_unit');
  const per_amount = _.get(course, 'per_amount');

  const per_session = parseInt(session_count) === 100000 ? '' : `/${session_count}`;

  const payment_count = ['per_session', 'session'].includes(per_unit)
    ? i18n.t('RemoteConfig.Course.Purchase.per_session', {
        session: `${per_amount}${per_session}`,
      })
    : i18n.t('RemoteConfig.Course.Purchase.full_session_txt');

  // send email effect
  clients.sendgridClient.getClient().sendEmail(user_id, {
    template: {
      name: i18n.getTemplateSuffixName('user.room.reminder'),
    },
    ...ctxData,
    course: {
      ..._.pick(course, ['id', 'name']),
      session_at,
      session_count: helpers.formatSessionOccurenceWithI18n(i18n)(session_count),
      session_duration: helpers.formatCallDurationWithI18n(i18n)(session_duration),
      diffMin,
    },
    tuition: {
      payment_count,
    },
    route: {
      advisor_url: clients.routeWebClient.getClient().toUserUrl('advisor', _.get(ctxData, 'advisor')),
      user_url: clients.routeWebClient.getClient().toUserUrl('profile'),
      course_url: clients.routeWebClient.getClient().toUserUrl('courseDetail', course),
      course_filter_url: clients.routeWebClient.getClient().toUserUrl('courseFilter'),
      room_url: clients.routeWebClient.getClient().toUserUrl('room', room),
    },
  });
};
