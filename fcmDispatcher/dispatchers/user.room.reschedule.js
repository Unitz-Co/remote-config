exports.getQuery = () => `
  query($user_id: String!, $advisor_id: String!, $room_id: uuid!, $course_id: uuid!) {
    advisor: advisor_by_pk(id: $advisor_id) {
      id
      profile {
        display_name
      }
    }
    room: course_room_by_pk(id: $room_id) {
      id
      start_at
      end_at
      last_edit: logs(limit: 1, order_by: {created_at: desc}) {
        advisor_id
        course_id
        start_at
        status
        end_at
        duration
        course_session_id
        course_session_occurence
      }
    }
    user: user_by_pk(id: $user_id) {
      id
      profile {
        display_name
      }
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
    }
  }
`;

exports.getVars = ({ payload }, { helpers: { _ } }) => {
  return {
    advisor_id: _.get(payload, 'course.advisor_id'),
    course_id: _.get(payload, 'course.id'),
    room_id: _.get(payload, 'room.id'),
    user_id: _.get(payload, 'purchase.user_id'),
  };
};

exports.dispatch = async ({ payload }, { ctxData, helpers, utils, clients: { routeWebClient } }) => {
  const { _, moment } = helpers;

  const course = _.get(ctxData, 'course');
  const room = _.get(ctxData, 'room');
  const start_at = _.get(ctxData, 'room.start_at');
  const $now = moment();
  const diffMin = moment(start_at).diff($now, 'minute');
  const user_id = _.get(ctxData, 'user.id');
  const i18n = await utils.forUser(user_id);

  const $start_at = moment(_.get(room, 'start_at'));
  const advisor_id = _.get(ctxData, 'advisor.id');

  const courseDisplayName = `${_.get(course, 'name')}(${$start_at
    .utcOffset(await utils.getUserTimezone(user_id))
    .locale(i18n.locale)
    .format(helpers.START_TIME_FORMAT)})`;

  // const title = `Thay đổi giờ học lớp ${courseDisplayName}`;
  const title = i18n.t('RemoteConfig.Room.UserRoomReschedule.title', {
    course: courseDisplayName,
  });

  const body = i18n.t('RemoteConfig.Room.UserRoomReschedule.body', {
    time: $start_at
      .utcOffset(await utils.getUserTimezone(user_id))
      .locale(i18n.locale)
      .format(helpers.START_TIME_FORMAT),
  });
  // const body = `Sẽ bắt đầu vào ${$start_at
  //   .utcOffset(await utils.getUserTimezone(advisor_id))
  //   .format(helpers.START_TIME_FORMAT)}.`;

  return {
    notification: {
      title,
      body,
    },
    data: {
      type: 'user.room.reschedule',
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

  const user_id = _.get(ctxData, 'user.id');

  const session_at = _.capitalize(
    $start_at
      .locale('vi')
      .utcOffset(await utils.getUserTimezone(user_id))
      .format(helpers.START_TIME_FULL_FORMAT)
  );

  const last_edit_time = moment(_.get(room, 'last_edit.0.start_at'));

  const session_count = _.get(ctxData, 'course.session_occurence', 0);
  const session_duration = _.get(ctxData, 'course.session_duration', 0);

  const per_unit = _.get(course, 'per_unit');
  const per_amount = _.get(course, 'per_amount');

  const per_session = parseInt(session_count) === 100000 ? '' : `/${session_count}`;
  const payment_count = ['per_session', 'session'].includes(per_unit) ? `${per_amount}${per_session} buổi` : 'Trọn gói';

  await clients.hasuraClient.getClient().request(
    `
    mutation upsertnotifevent($payload: jsonb, $type: String) {
      insert_notification_one(
        object: {
          owner_id: "${user_id}"
          type_id: $type
          payload: $payload
        }
      ) {
        id
      }
    }
  `,
    {
      type: 'user.room.reschedule',
      payload,
    }
  );

  // send email effect
  clients.sendgridClient.getClient().sendEmail(user_id, {
    template: {
      name: 'user.room.reschedule',
    },
    ...ctxData,
    course: {
      ..._.pick(course, ['id', 'name']),
      reschedule_time: session_at,
      last_edit_time: _.capitalize(
        last_edit_time
          .locale('vi')
          .utcOffset(await utils.getUserTimezone(user_id))
          .format(helpers.START_TIME_FULL_FORMAT)
      ),
      session_count: helpers.formatSessionOccurence(session_count),
      session_duration: helpers.formatCallDuration(session_duration),
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
