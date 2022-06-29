exports.getQuery = () => `
  query($user_id: String!, $advisor_id: String!, $course_id: uuid!, $course_activity_id: uuid!) {
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
    activity: course_activity_by_pk(id: $course_activity_id) {
      course_id
      payload
      creator {
        id
      }
    }
    course: course_by_pk(id: $course_id) {
        advisor_id
        type
        pricing_type
        price_amount
        price_currency
        per_amount
        per_unit
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
            
        enrolls {
            user_id
            course_id
            user {
              id
              profile {
                display_name
                id
                avatar_url
              }
            }
        }
    }    
}
`;

exports.getVars = ({ payload }, { helpers: { _ } }) => {
  return {
    advisor_id: _.get(payload, 'course.advisor_id'),
    course_id: _.get(payload, 'course.id'),
    user_id: _.get(payload, 'user_id'),
    course_activity_id: _.get(payload, 'course_activity.id'),
  };
};

exports.dispatch = async ({ payload }, { ctxData, utils, helpers }) => {
  const { _ } = helpers;
  const course = _.get(ctxData, 'course');
  const user = _.get(ctxData, 'user');
  const courseDisplayName = _.get(course, 'name');

  const user_id = _.get(user, 'id');

  const i18n = await utils.forUser(user_id);
  const title = i18n.t('RemoteConfig.RATCourse.UserRATCourseRequest.title');
  const body = i18n.t('RemoteConfig.RATCourse.UserRATCourseRequest.body', {
    course: courseDisplayName,
  });

  return {
    notification: {
      // title: `Your booking #${bookingId} is completed`,
      title,
      body,
    },
    data: {
      type: 'user.RATCourse.requested',
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
  const course = _.get(ctxData, 'course');
  const session_count = _.get(course, 'session_occurence', 0);
  const session_duration = _.get(course, 'session_duration', 0);

  const user = _.get(ctxData, 'user');

  const $start_at = moment(_.get(course, 'first_room.0.start_at'));
  const room = _.get(course, 'first_room.0');

  const user_id = _.get(user, 'id');

  const i18n = await utils.forUser(user_id);

  const session_at = _.capitalize(
    $start_at
      .locale(i18n.locale)
      .utcOffset(await utils.getUserTimezone(user_id))
      .format(helpers.START_TIME_FULL_FORMAT)
  );

  const attendees_count = _.get(course, 'attendees_aggregate.aggregate.count', 0);
  const sessions = _.get(ctxData, 'activity.payload.sessions');
  const user_note = _.get(ctxData, 'activity.payload.notes');

  //   inapp noti effect
  hasuraClient.getClient().request(
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
      type: 'user.RATCourse.requested',
      payload,
    }
  );

  sendgridClient.getClient().sendEmail(user_id, {
    template: {
      name: i18n.getTemplateSuffixName('user.RATCourse.requested'),
    },
    ...i18n.getContactEmailInfo('user.RATCourse.requested'),
    ...ctxData,
    user,
    course: {
      ..._.pick(course, ['id', 'name']),
      session_at,
      session_count: helpers.formatSessionOccurenceWithI18n(i18n)(session_count),
      session_duration: helpers.formatCallDurationWithI18n(i18n)(session_duration),
      attendee_count: helpers.formatAttendeeWithI18n(i18n)(attendees_count),
      RAT_time: helpers.formatSessionSlotTime(i18n)(sessions),
      notes: user_note || '',
    },

    route: {
      advisor_url: routeWebClient.getClient().toUserUrl('advisor', _.get(ctxData, 'advisor')),
      user_url: routeWebClient.getClient().toUserUrl('profile'),
      course_url: routeWebClient.getClient().toUserUrl('courseDetail', course),
      course_filter_url: routeWebClient.getClient().toUserUrl('courseFilter'),
      room_url: routeWebClient.getClient().toUserUrl('room', room),
      wallet_url: routeWebClient.getClient().toUserUrl('userWallet'),
      payment_url: routeWebClient.getClient().toUserUrl('payment', course),
      chat_url: routeWebClient.getClient().toUserUrl('messageWithAdvisor', _.get(ctxData, 'advisor')),
      home_url: routeWebClient.getClient().toUserUrl('home'),
      course_more_url: routeWebClient
        .getClient()
        .toUserUrl('advisor', { ...(_.get(ctxData, 'advisor') || {}), tab: 'course' }, false),
    },
  });
};
