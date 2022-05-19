exports.getQuery = () => `
  query($where: course_bool_exp) {
    course(where: $where) {
      id
      name
      categories {
        category {
          id
          display_name
          display_name_en_US
          display_name_vi_VN
          slug
        }
      }
    }
  }
`;

exports.indices = () => {
  return {
    settings: {
      analysis: {
        analyzer: {
          course_vi_analyzer: {
            type: 'vi_analyzer',
            keep_punctuation: true,
            // stopwords: ['rất', 'những'],
          },
        },
      },
    },
    mappings: {
      properties: {
        id: {
          type: 'keyword',
        },
        name: {
          type: 'text',
          analyzer: 'course_vi_analyzer',
          fields: {
            search_as_you_type: {
              type: 'search_as_you_type',
              max_shingle_size: 4,
            },
            completion: {
              type: 'completion',
              analyzer: 'course_vi_analyzer',
            },
            keyword: {
              type: 'keyword',
            },
          },
        },
        category: {
          type: 'text',
          analyzer: 'course_vi_analyzer',
          fields: {
            search_as_you_type: {
              type: 'search_as_you_type',
            },
            completion: {
              type: 'completion',
              analyzer: 'course_vi_analyzer',
            },
            keyword: {
              type: 'keyword',
            },
          },
        },
      },
    },
  };
};

exports.transformDocument = async ({ payload }, { helpers }) => {
  return {
    id: payload.id,
    name: payload.name,
    category: (() => {
      const names = [
        ...helpers.flattenGet(payload, 'categories.category.display_name_en_US'),
        ...helpers.flattenGet(payload, 'categories.category.display_name_vi_VN'),
      ];
      const rtn = names.flatMap((val) => {
        return [val, `learn ${val} online`, `hoc ${val} online`, `khoa ${val} online`, `${val} online`];
      });
      return rtn;
    })(),
  };
};

exports.searchQuery = ({ payload }, { helpers }) => {
  return {
    body: {
      suggest: {
        items: {
          prefix: `${helpers._.get(payload, 'search', '')}`,
          completion: {
            skip_duplicates: true,
            size: 12,
            field: 'category.completion',
          },
        },
      },
    },
  };
};

exports.searchParserIds = ({ payload }, { helpers }) => {
  const { _, flattenGet } = helpers;
  const _res = _.get(payload, 'body');
  const values = flattenGet(_res, 'suggest.items.options');
  return _.map(values, (val) => _.get(val, '_source.id'));
};
